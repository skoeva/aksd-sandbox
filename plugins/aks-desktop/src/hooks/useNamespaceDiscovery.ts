// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { K8s } from '@kinvolk/headlamp-plugin/lib';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { runCommandAsync } from '../utils/azure/az-cli';
import {
  PROJECT_ID_LABEL,
  PROJECT_MANAGED_BY_LABEL,
  PROJECT_MANAGED_BY_VALUE,
} from '../utils/constants/projectLabels';
import { getClusterSettings } from '../utils/shared/clusterSettings';

export interface DiscoveredNamespace {
  name: string;
  clusterName: string;
  resourceGroup: string;
  subscriptionId: string;
  labels: Record<string, string> | null;
  provisioningState: string;
  /** Whether this namespace already has AKS Desktop project labels */
  isAksProject: boolean;
  /** Whether this is an AKS managed namespace (vs regular K8s namespace) */
  isManagedNamespace: boolean;
  /** Categorization for UI display purposes */
  category: 'needs-conversion' | 'needs-import';
}

export interface UseNamespaceDiscoveryReturn {
  namespaces: DiscoveredNamespace[];
  needsConversion: DiscoveredNamespace[];
  needsImport: DiscoveredNamespace[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

function getClusterName(resourceId: string): string {
  const m = resourceId.match(/managedClusters\/([^/]+)/);
  return m ? m[1] : '';
}

// System namespaces to filter out
const SYSTEM_NAMESPACES = new Set([
  'kube-system',
  'kube-public',
  'kube-node-lease',
  'default',
  'gatekeeper-system',
]);

function isAksDesktopProject(labels: Record<string, string> | null): boolean {
  if (!labels) return false;
  return (
    !!labels[PROJECT_ID_LABEL] && labels[PROJECT_MANAGED_BY_LABEL] === PROJECT_MANAGED_BY_VALUE
  );
}

/**
 * Returns the query string formatted for the current platform's shell.
 * On Windows, the Azure Resource Graph query must be wrapped in double quotes
 * because `az graph query -q` passes the value through cmd.exe which strips
 * single quotes. On Unix, the query is passed as-is (child_process handles quoting).
 */
function quoteForPlatform(query: string): string {
  const isWindows = (window as any)?.desktopApi?.platform === 'win32';
  return isWindows ? `"${query}"` : query;
}

function isAlreadyImported(ns: { name: string; clusterName: string }): boolean {
  const settings = getClusterSettings(ns.clusterName);
  const allowedNamespaces: string[] = settings.allowedNamespaces ?? [];
  return allowedNamespaces.includes(ns.name);
}

/**
 * Fetches all namespaces from a single registered cluster via the K8s API.
 * Returns an array of DiscoveredNamespace entries with isManagedNamespace=false.
 */
function fetchRegularNamespacesForCluster(clusterName: string): Promise<DiscoveredNamespace[]> {
  return new Promise(resolve => {
    let cancelFn: Promise<() => void> | null = null;
    // Guard against the K8s apiList calling both success and error callbacks
    let settled = false;

    const cleanup = () => {
      if (cancelFn) {
        void Promise.resolve(cancelFn).then(cancel => {
          if (typeof cancel === 'function') cancel();
        });
      }
    };

    cancelFn = K8s.ResourceClasses.Namespace.apiList(
      (namespaces: any[]) => {
        if (settled) return;
        settled = true;
        cleanup();

        const results: DiscoveredNamespace[] = namespaces
          .map((ns: any) => {
            // Headlamp apiList returns objects with `jsonData` wrapper; fall back to direct `metadata` access
            const name: string = ns.jsonData?.metadata?.name || ns.metadata?.name || '';
            const labels: Record<string, string> | null =
              ns.jsonData?.metadata?.labels || ns.metadata?.labels || null;
            const isProject = isAksDesktopProject(labels);

            const category: DiscoveredNamespace['category'] = isProject
              ? 'needs-import'
              : 'needs-conversion';
            return {
              name,
              clusterName,
              resourceGroup: '',
              subscriptionId: '',
              labels,
              provisioningState: 'Succeeded',
              isAksProject: isProject,
              isManagedNamespace: false,
              category,
            };
          })
          .filter((ns: DiscoveredNamespace) => {
            if (!ns.name) return false;
            if (SYSTEM_NAMESPACES.has(ns.name)) return false;
            if (isAlreadyImported(ns)) return false;
            return true;
          });
        resolve(results);
      },
      (err: any) => {
        if (settled) return;
        settled = true;
        cleanup();
        console.warn(`Failed to list namespaces for cluster ${clusterName}:`, err);
        resolve([]);
      },
      {
        cluster: clusterName,
      }
    )();
  });
}

/**
 * Hook to discover both managed namespaces (via Azure Resource Graph) and regular
 * Kubernetes namespaces (via the K8s API on registered clusters).
 * Returns all discoverable namespaces with their AKS project status and categorization.
 */
export const useNamespaceDiscovery = (): UseNamespaceDiscoveryReturn => {
  const [namespaces, setNamespaces] = useState<DiscoveredNamespace[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latestRequestIdRef = useRef(0);
  const clustersConf = K8s.useClustersConf();

  // Produce a stable string key from cluster names so that `discover` (below)
  // is only recreated when the actual set of registered clusters changes,
  // not every time clustersConf returns a new object reference.
  const registeredClusterNamesKey = useMemo(() => {
    if (!clustersConf) return '';
    return Object.keys(clustersConf).sort().join(',');
  }, [clustersConf]);

  const registeredClusterNames = useMemo(() => {
    if (!registeredClusterNamesKey) return [];
    return registeredClusterNamesKey.split(',');
  }, [registeredClusterNamesKey]);

  const discover = useCallback(async () => {
    const requestId = ++latestRequestIdRef.current;
    const isStale = () => latestRequestIdRef.current !== requestId;

    setLoading(true);
    setError(null);
    try {
      // --- Path 1: Managed namespaces via Azure Resource Graph ---
      let managedNsError: string | null = null;
      let managedNamespaces: DiscoveredNamespace[] = [];
      try {
        const query = `resources | where type =~ 'microsoft.containerservice/managedclusters/managednamespaces' | project id, name, resourceGroup, subscriptionId, labels=properties['labels'], provisioningState=properties['provisioningState']`;

        const { stdout, stderr } = await runCommandAsync('az', [
          'graph',
          'query',
          '-q',
          quoteForPlatform(query),
          '--output',
          'json',
        ]);

        if (stderr && !stdout) {
          // Only treat stderr as an error if there's no stdout (i.e., the command truly failed).
          // Azure CLI often writes warnings to stderr even on success.
          throw new Error(stderr);
        }

        let data;
        try {
          data = JSON.parse(stdout).data;
        } catch {
          throw new Error(`Failed to parse Azure Resource Graph response: ${stdout.slice(0, 200)}`);
        }

        managedNamespaces = data
          .map((item: any) => {
            const name = item.name;
            const clusterName = getClusterName(item.id);
            const labels = item.labels || null;
            const provisioningState = item.provisioningState || '';
            const isProject = isAksDesktopProject(labels);

            const category: DiscoveredNamespace['category'] = isProject
              ? 'needs-import'
              : 'needs-conversion';
            return {
              name,
              clusterName,
              resourceGroup: item.resourceGroup,
              subscriptionId: item.subscriptionId,
              labels,
              provisioningState,
              isAksProject: isProject,
              isManagedNamespace: true,
              category,
            };
          })
          .filter((ns: DiscoveredNamespace) => {
            // Filter out namespaces with malformed resource IDs (no cluster name extractable)
            if (!ns.clusterName) return false;
            // Filter out system namespaces
            if (SYSTEM_NAMESPACES.has(ns.name)) return false;
            // Filter out non-succeeded namespaces
            if (ns.provisioningState && ns.provisioningState.toLowerCase() !== 'succeeded')
              return false;
            // Filter out already-imported namespaces (regardless of category)
            if (isAlreadyImported(ns)) return false;
            return true;
          });
      } catch (err) {
        // Log but don't fail — regular namespace discovery can still proceed
        console.warn('Failed to discover managed namespaces:', err);
        managedNsError = err instanceof Error ? err.message : String(err);
      }

      // --- Path 2: Regular namespaces from registered clusters via K8s API ---
      let regularNamespaces: DiscoveredNamespace[] = [];
      try {
        const clusterResults = await Promise.all(
          registeredClusterNames.map(clusterName => fetchRegularNamespacesForCluster(clusterName))
        );
        regularNamespaces = clusterResults.flat();
      } catch (err) {
        console.warn('Failed to discover regular namespaces:', err);
      }

      // --- Merge and deduplicate ---
      // Managed namespaces take priority (they have richer metadata like resourceGroup/subscriptionId)
      const managedKeys = new Set(managedNamespaces.map(ns => `${ns.clusterName}/${ns.name}`));
      const deduplicatedRegular = regularNamespaces.filter(
        ns => !managedKeys.has(`${ns.clusterName}/${ns.name}`)
      );

      const allNamespaces = [...managedNamespaces, ...deduplicatedRegular];

      if (isStale()) return;

      if (allNamespaces.length === 0 && managedNsError) {
        setError(managedNsError);
      }

      setNamespaces(allNamespaces);
    } finally {
      if (!isStale()) {
        setLoading(false);
      }
    }
  }, [registeredClusterNamesKey]);

  useEffect(() => {
    discover();
    return () => {
      latestRequestIdRef.current += 1;
    };
  }, [discover]);

  const needsConversion = useMemo(
    () => namespaces.filter(ns => ns.category === 'needs-conversion'),
    [namespaces]
  );
  const needsImport = useMemo(
    () => namespaces.filter(ns => ns.category === 'needs-import'),
    [namespaces]
  );

  return {
    namespaces,
    needsConversion,
    needsImport,
    loading,
    error,
    refresh: discover,
  };
};
