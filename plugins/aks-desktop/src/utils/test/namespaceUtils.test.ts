// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { beforeEach, describe, expect, test, vi } from 'vitest';

// Mock the K8s API
const mockGet = vi.fn();
const mockPut = vi.fn();

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  K8s: {
    ResourceClasses: {
      Namespace: {
        apiEndpoint: {
          get: (...args: any[]) => mockGet(...args),
          put: (...args: any[]) => mockPut(...args),
        },
      },
    },
  },
}));

import { applyProjectLabels, fetchNamespaceData } from '../kubernetes/namespaceUtils';

/**
 * Helper: creates a mockGet implementation that calls the success callback
 * asynchronously (via queueMicrotask) so that cancelFn is assigned before
 * the callback accesses it — matching real Headlamp API behaviour.
 */
function mockGetSuccess(response: any, mockCancel: ReturnType<typeof vi.fn> = vi.fn()) {
  mockGet.mockImplementation((_name: string, successCb: (ns: any) => void) => {
    const cancelPromise = Promise.resolve(mockCancel);
    queueMicrotask(() => successCb(response));
    return cancelPromise;
  });
  return mockCancel;
}

function mockGetError(error: any, mockCancel: ReturnType<typeof vi.fn> = vi.fn()) {
  mockGet.mockImplementation(
    (_name: string, _successCb: (ns: any) => void, errorCb: (err: any) => void) => {
      const cancelPromise = Promise.resolve(mockCancel);
      queueMicrotask(() => errorCb(error));
      return cancelPromise;
    }
  );
  return mockCancel;
}

describe('fetchNamespaceData', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockPut.mockReset();
  });

  test('resolves with namespace data', async () => {
    const mockNs = { metadata: { name: 'test-ns', labels: {} } };
    mockGetSuccess(mockNs);

    const result = await fetchNamespaceData('test-ns', 'test-cluster');

    expect(result).toEqual(mockNs);
    expect(mockGet).toHaveBeenCalledWith(
      'test-ns',
      expect.any(Function),
      expect.any(Function),
      {},
      'test-cluster'
    );
  });

  test('calls cancel function on success', async () => {
    const mockCancel = mockGetSuccess({ metadata: {} });

    await fetchNamespaceData('test-ns', 'test-cluster');

    // Wait for the cancelFn.then to resolve
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(mockCancel).toHaveBeenCalled();
  });

  test('rejects with error on failure', async () => {
    mockGetError('Not found');

    await expect(fetchNamespaceData('missing-ns', 'test-cluster')).rejects.toThrow(
      'Failed to fetch namespace: Not found'
    );
  });

  test('calls cancel function on error', async () => {
    const mockCancel = mockGetError('Not found');

    try {
      await fetchNamespaceData('missing-ns', 'test-cluster');
    } catch {
      // Expected
    }

    await new Promise(resolve => setTimeout(resolve, 0));
    expect(mockCancel).toHaveBeenCalled();
  });
});

describe('applyProjectLabels', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockPut.mockReset();
  });

  test('applies all four project labels to namespace', async () => {
    const existingNs = {
      metadata: {
        name: 'test-ns',
        labels: { 'existing-label': 'value' },
      },
      spec: {},
    };
    mockGetSuccess(existingNs);
    mockPut.mockResolvedValue({});

    await applyProjectLabels({
      namespaceName: 'test-ns',
      clusterName: 'test-cluster',
      subscriptionId: 'sub-123',
      resourceGroup: 'rg-test',
    });

    expect(mockPut).toHaveBeenCalledTimes(1);
    const putArgs = mockPut.mock.calls[0];
    const updatedData = putArgs[0];

    expect(updatedData.metadata.labels).toEqual({
      'existing-label': 'value',
      'headlamp.dev/project-id': 'test-ns',
      'headlamp.dev/project-managed-by': 'aks-desktop',
      'aks-desktop/project-subscription': 'sub-123',
      'aks-desktop/project-resource-group': 'rg-test',
    });
    // Should be called with cluster name
    expect(putArgs[2]).toBe('test-cluster');
  });

  test('preserves existing labels', async () => {
    const existingNs = {
      metadata: {
        name: 'test-ns',
        labels: { team: 'platform', env: 'prod' },
      },
    };
    mockGetSuccess(existingNs);
    mockPut.mockResolvedValue({});

    await applyProjectLabels({
      namespaceName: 'test-ns',
      clusterName: 'test-cluster',
      subscriptionId: 'sub-123',
      resourceGroup: 'rg-test',
    });

    const updatedLabels = mockPut.mock.calls[0][0].metadata.labels;
    expect(updatedLabels['team']).toBe('platform');
    expect(updatedLabels['env']).toBe('prod');
    expect(updatedLabels['headlamp.dev/project-id']).toBe('test-ns');
  });

  test('handles namespace with no existing labels', async () => {
    const existingNs = {
      metadata: { name: 'test-ns' },
    };
    mockGetSuccess(existingNs);
    mockPut.mockResolvedValue({});

    await applyProjectLabels({
      namespaceName: 'test-ns',
      clusterName: 'test-cluster',
      subscriptionId: 'sub-123',
      resourceGroup: 'rg-test',
    });

    const updatedLabels = mockPut.mock.calls[0][0].metadata.labels;
    expect(updatedLabels['headlamp.dev/project-id']).toBe('test-ns');
    expect(updatedLabels['headlamp.dev/project-managed-by']).toBe('aks-desktop');
  });

  test('omits Azure metadata labels when subscriptionId and resourceGroup are empty', async () => {
    const existingNs = {
      metadata: {
        name: 'test-ns',
        labels: { 'existing-label': 'value' },
      },
    };
    mockGetSuccess(existingNs);
    mockPut.mockResolvedValue({});

    await applyProjectLabels({
      namespaceName: 'test-ns',
      clusterName: 'test-cluster',
      subscriptionId: '',
      resourceGroup: '',
    });

    const updatedLabels = mockPut.mock.calls[0][0].metadata.labels;
    expect(updatedLabels['headlamp.dev/project-id']).toBe('test-ns');
    expect(updatedLabels['headlamp.dev/project-managed-by']).toBe('aks-desktop');
    expect(updatedLabels).not.toHaveProperty('aks-desktop/project-subscription');
    expect(updatedLabels).not.toHaveProperty('aks-desktop/project-resource-group');
  });

  test('throws when fetch fails', async () => {
    mockGetError('Namespace not found');

    await expect(
      applyProjectLabels({
        namespaceName: 'missing-ns',
        clusterName: 'test-cluster',
        subscriptionId: 'sub-123',
        resourceGroup: 'rg-test',
      })
    ).rejects.toThrow('Failed to fetch namespace');
  });

  test('throws when put fails', async () => {
    const existingNs = { metadata: { name: 'test-ns', labels: {} } };
    mockGetSuccess(existingNs);
    mockPut.mockRejectedValue(new Error('Forbidden'));

    await expect(
      applyProjectLabels({
        namespaceName: 'test-ns',
        clusterName: 'test-cluster',
        subscriptionId: 'sub-123',
        resourceGroup: 'rg-test',
      })
    ).rejects.toThrow('Forbidden');
  });
});
