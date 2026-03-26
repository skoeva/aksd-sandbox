// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.
import { LOGIN_POLL_INTERVAL_MS, LOGIN_TIMEOUT_MS } from '../constants/timing';
import {
  debugLog,
  getErrorMessage,
  isAzCliLoggedIn,
  isCliNotFoundError,
  needsRelogin,
  runCommandAsync,
} from './az-cli-core';
import { getAzCommand, getInstallationInstructions } from './az-cli-path';

export async function getLoginStatus(): Promise<{
  isLoggedIn: boolean;
  username?: string;
  tenantId?: string;
  subscriptionId?: string;
  needsRelogin?: boolean;
  error?: string;
}> {
  try {
    const { stdout, stderr } = await runCommandAsync('az', ['account', 'show', '-o', 'json']);

    if (stderr && isCliNotFoundError(stderr)) {
      return {
        isLoggedIn: false,
        error: 'Azure CLI not found. Please install Azure CLI first.',
      };
    }

    if (!stdout) {
      const needsReloginFlag = needsRelogin(stderr);
      if (needsReloginFlag) console.warn('AKS-plugin: Azure CLI requires re-login');
      return {
        isLoggedIn: false,
        needsRelogin: needsReloginFlag,
        error: stderr || 'Not logged in',
      };
    }

    try {
      const account = JSON.parse(stdout);
      return {
        isLoggedIn: true,
        username: account.user?.name,
        tenantId: account.tenantId,
        subscriptionId: account.id,
      };
    } catch (err) {
      return { isLoggedIn: false, error: 'Failed to parse account information' };
    }
  } catch (error) {
    console.error('Error getting Azure login status:', error);
    return {
      isLoggedIn: false,
      error: getErrorMessage(error),
    };
  }
}

export async function getUserAccountInfo(): Promise<any> {
  const { stdout, stderr } = await runCommandAsync('az', ['account', 'show', '-o', 'json']);
  if (!stdout) {
    const err: any = new Error(stderr || 'Failed to get account info');
    if (needsRelogin(stderr)) err.needsRelogin = true;
    throw err;
  }
  return JSON.parse(stdout);
}

export async function getAccessToken(): Promise<any> {
  const { stdout, stderr } = await runCommandAsync('az', ['account', 'get-access-token']);
  if (!stdout) {
    const err: any = new Error(stderr || 'Failed to get access token');
    if (needsRelogin(stderr)) err.needsRelogin = true;
    throw err;
  }
  return JSON.parse(stdout);
}

export async function initiateLogin(): Promise<{ success: boolean; message: string }> {
  try {
    debugLog('[AZ-CLI] ===== INITIATING LOGIN =====');
    debugLog('[AZ-CLI] Resolved command:', getAzCommand());
    debugLog(
      '[AZ-CLI] Is Electron?:',
      typeof window !== 'undefined' && (window as any).desktopApi !== undefined
    );
    debugLog('[AZ-CLI] Platform:', typeof process !== 'undefined' ? process.platform : 'unknown');

    const { stdout, stderr } = await runCommandAsync('az', ['login']);

    debugLog('[AZ-CLI] Login stdout:', stdout);
    debugLog('[AZ-CLI] Login stderr:', stderr);

    if (stderr && (isCliNotFoundError(stderr) || stderr.includes('ENOENT'))) {
      console.error('[AZ-CLI] Azure CLI not found error detected in stderr');
      const instructions = getInstallationInstructions();
      return {
        success: false,
        message: `Azure CLI not found. Please install Azure CLI first.\n\n${instructions}`,
      };
    }

    // If we get here, login was initiated successfully
    debugLog('[AZ-CLI] Login initiated successfully');
    return {
      success: true,
      message: 'Login process initiated. Please complete authentication in your browser.',
    };
  } catch (error) {
    console.error('[AZ-CLI] Error initiating Azure login:', error);
    const errorMessage = getErrorMessage(error);

    // Check if it's an ENOENT error
    if (errorMessage.includes('ENOENT') || errorMessage.includes('spawn az ENOENT')) {
      console.error('[AZ-CLI] ENOENT error - Azure CLI command not found');
      const instructions = getInstallationInstructions();
      return {
        success: false,
        message: `Azure CLI not found. Please install Azure CLI first.\n\n${instructions}`,
      };
    }

    return {
      success: false,
      message: `Failed to initiate login: ${errorMessage}`,
    };
  }
}

export function monitorLoginStatus(
  onStatusChange: (status: { isLoggedIn: boolean; message: string }) => void,
  intervalMs = LOGIN_POLL_INTERVAL_MS
): () => void {
  let isPolling = true;
  let pollCount = 0;
  const maxPolls = 60;

  const poll = async () => {
    if (!isPolling) return;
    pollCount++;

    try {
      const status = await getLoginStatus();
      if (status.isLoggedIn) {
        onStatusChange({ isLoggedIn: true, message: 'Login successful!' });
        isPolling = false;
      } else {
        const remaining = ((maxPolls - pollCount) * intervalMs) / 1000;
        onStatusChange({
          isLoggedIn: false,
          message: `Waiting for login... (${Math.floor(remaining / 60)}:${String(
            remaining % 60
          ).padStart(2, '0')})`,
        });
        if (pollCount >= maxPolls) {
          onStatusChange({ isLoggedIn: false, message: 'Login timeout. Please try again.' });
          isPolling = false;
        } else {
          setTimeout(poll, intervalMs);
        }
      }
    } catch (error) {
      onStatusChange({ isLoggedIn: false, message: 'Error checking login status' });
      isPolling = false;
    }
  };

  poll();
  return () => {
    isPolling = false;
  };
}

export async function login(timeoutMs = LOGIN_TIMEOUT_MS): Promise<boolean> {
  if (await isAzCliLoggedIn()) return true;
  const init = await initiateLogin();
  if (!init.success) return false;

  const start = Date.now();
  return new Promise(resolve => {
    const poll = async () => {
      if (await isAzCliLoggedIn()) return resolve(true);
      if (Date.now() - start > timeoutMs) return resolve(false);
      setTimeout(poll, LOGIN_POLL_INTERVAL_MS);
    };
    poll();
  });
}
