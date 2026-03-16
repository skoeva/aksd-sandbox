// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// --- Mocks (vi.hoisted ensures variables are available when vi.mock is hoisted) ---

const mockUseGet = vi.hoisted(() => vi.fn());
const mockGetManagedNamespaceDetails = vi.hoisted(() => vi.fn());
const mockUpdateManagedNamespace = vi.hoisted(() => vi.fn());
const mockT = vi.hoisted(() => (key: string) => key);

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  K8s: {
    ResourceClasses: {
      Namespace: {
        useGet: mockUseGet,
      },
    },
  },
  useTranslation: () => ({ t: mockT }),
}));

vi.mock('../../../utils/azure/az-cli', () => ({
  getManagedNamespaceDetails: mockGetManagedNamespaceDetails,
  updateManagedNamespace: mockUpdateManagedNamespace,
}));

import { detailsCache, useInfoTab } from './useInfoTab';

/** A minimal project fixture used across tests. */
const defaultProject = {
  clusters: ['my-cluster'],
  namespaces: ['my-namespace'],
  id: 'my-project',
};

/** A namespace instance returned by Headlamp with subscription and resource group labels. */
function createNamespaceInstance(subscription = 'sub-123', resourceGroup = 'rg-prod') {
  return {
    jsonData: {
      metadata: {
        labels: {
          'aks-desktop/project-subscription': subscription,
          'aks-desktop/project-resource-group': resourceGroup,
        },
      },
    },
  };
}

/** A namespace details object returned by the Azure CLI. */
function createNamespaceDetails(
  overrides: Partial<{
    ingress: string;
    egress: string;
    cpuRequest: string;
    cpuLimit: string;
    memoryRequest: string;
    memoryLimit: string;
  }> = {}
) {
  const {
    ingress = 'AllowSameNamespace',
    egress = 'AllowAll',
    cpuRequest = '500m',
    cpuLimit = '1000m',
    memoryRequest = '256Mi',
    memoryLimit = '512Mi',
  } = overrides;

  return {
    properties: {
      defaultNetworkPolicy: { ingress, egress },
      defaultResourceQuota: { cpuRequest, cpuLimit, memoryRequest, memoryLimit },
    },
  };
}

describe('useInfoTab', () => {
  beforeEach(() => {
    mockUseGet.mockReturnValue([createNamespaceInstance()]);
    mockGetManagedNamespaceDetails.mockResolvedValue(createNamespaceDetails());
  });

  afterEach(() => {
    vi.resetAllMocks();
    detailsCache.clear();
  });

  // --- Initial loading state ---

  test('starts in loading state and resolves after fetch completes', async () => {
    const { result } = renderHook(() => useInfoTab(defaultProject));

    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBeNull();
    expect(result.current.namespaceDetails).not.toBeNull();
  });

  // --- Missing cluster or resource group ---

  test('sets namespaceDetails to null and skips fetch when cluster is missing', async () => {
    const project = { ...defaultProject, clusters: [] };

    const { result } = renderHook(() => useInfoTab(project));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(mockGetManagedNamespaceDetails).not.toHaveBeenCalled();
    expect(result.current.namespaceDetails).toBeNull();
  });

  test('sets namespaceDetails to null and skips fetch when resourceGroup label is absent', async () => {
    mockUseGet.mockReturnValue([{ jsonData: { metadata: { labels: {} } } }]);

    const { result } = renderHook(() => useInfoTab(defaultProject));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(mockGetManagedNamespaceDetails).not.toHaveBeenCalled();
    expect(result.current.namespaceDetails).toBeNull();
  });

  // --- Error handling ---

  test('sets error and clears namespaceDetails when getManagedNamespaceDetails throws', async () => {
    mockGetManagedNamespaceDetails.mockRejectedValue(new Error('details error'));

    const { result } = renderHook(() => useInfoTab(defaultProject));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe('Failed to fetch managed namespace details');
    expect(result.current.namespaceDetails).toBeNull();
  });

  test('does not surface error when fetch fails but cached data exists', async () => {
    const cached = createNamespaceDetails();
    detailsCache.set('my-cluster/my-project', cached);
    mockGetManagedNamespaceDetails.mockRejectedValue(new Error('network error'));

    const { result } = renderHook(() => useInfoTab(defaultProject));

    await waitFor(() => expect(result.current.revalidating).toBe(false));

    expect(result.current.error).toBeNull();
    expect(result.current.namespaceDetails).toEqual(cached);
  });

  // --- Stale-while-revalidate ---

  test('shows cached data immediately without a loading spinner on subsequent opens', () => {
    detailsCache.set('my-cluster/my-project', createNamespaceDetails());

    const { result } = renderHook(() => useInfoTab(defaultProject));

    expect(result.current.loading).toBe(false);
    expect(result.current.namespaceDetails).not.toBeNull();
  });

  test('revalidating is true during background fetch when cached data exists', async () => {
    detailsCache.set('my-cluster/my-project', createNamespaceDetails());

    const { result } = renderHook(() => useInfoTab(defaultProject));

    expect(result.current.revalidating).toBe(true);
    expect(result.current.loading).toBe(false);

    await waitFor(() => expect(result.current.revalidating).toBe(false));
  });

  test('updates namespaceDetails when background revalidation completes', async () => {
    const stale = createNamespaceDetails({ ingress: 'AllowAll' });
    const fresh = createNamespaceDetails({ ingress: 'DenyAll' });
    detailsCache.set('my-cluster/my-project', stale);
    mockGetManagedNamespaceDetails.mockResolvedValue(fresh);

    const { result } = renderHook(() => useInfoTab(defaultProject));

    expect(result.current.namespaceDetails).toEqual(stale);

    await waitFor(() => expect(result.current.revalidating).toBe(false));

    expect(result.current.namespaceDetails).toEqual(fresh);
  });

  // --- handleRefresh ---

  test('handleRefresh clears the cache and triggers a fresh fetch', async () => {
    detailsCache.set('my-cluster/my-project', createNamespaceDetails());

    const { result } = renderHook(() => useInfoTab(defaultProject));

    await waitFor(() => expect(result.current.revalidating).toBe(false));

    expect(mockGetManagedNamespaceDetails).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.handleRefresh();
    });

    await waitFor(() => expect(result.current.revalidating).toBe(false));

    expect(mockGetManagedNamespaceDetails).toHaveBeenCalledTimes(2);
  });

  // --- Form population from namespace details ---

  test('pre-populates formData from fetched namespace details', async () => {
    mockGetManagedNamespaceDetails.mockResolvedValue(
      createNamespaceDetails({
        ingress: 'AllowAll',
        egress: 'DenyAll',
        cpuRequest: '250m',
        cpuLimit: '500m',
        memoryRequest: '128Mi',
        memoryLimit: '256Mi',
      })
    );

    const { result } = renderHook(() => useInfoTab(defaultProject));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.formData.ingress).toBe('AllowAll');
    expect(result.current.formData.egress).toBe('DenyAll');
    expect(result.current.formData.cpuRequest).toBe(250);
    expect(result.current.formData.cpuLimit).toBe(500);
    expect(result.current.formData.memoryRequest).toBe(128);
    expect(result.current.formData.memoryLimit).toBe(256);
  });

  test('falls back to AllowSameNamespace for unrecognised ingress policy value', async () => {
    mockGetManagedNamespaceDetails.mockResolvedValue(
      createNamespaceDetails({ ingress: 'InvalidPolicy' })
    );

    const { result } = renderHook(() => useInfoTab(defaultProject));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.formData.ingress).toBe('AllowSameNamespace');
  });

  test('parses resource values without units as zero', async () => {
    mockGetManagedNamespaceDetails.mockResolvedValue(
      createNamespaceDetails({
        cpuRequest: 'invalid',
        memoryRequest: 'bad',
      })
    );

    const { result } = renderHook(() => useInfoTab(defaultProject));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.formData.cpuRequest).toBe(0);
    expect(result.current.formData.memoryRequest).toBe(0);
  });

  // --- hasChanges ---

  test('hasChanges is false initially after fetch', async () => {
    const { result } = renderHook(() => useInfoTab(defaultProject));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.hasChanges).toBe(false);
  });

  test('hasChanges becomes true after a form field is changed', async () => {
    const { result } = renderHook(() => useInfoTab(defaultProject));

    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.handleFormDataChange({ ingress: 'DenyAll' });
    });

    expect(result.current.hasChanges).toBe(true);
  });

  test('hasChanges returns to false after reverting a change back to the baseline', async () => {
    mockGetManagedNamespaceDetails.mockResolvedValue(
      createNamespaceDetails({ ingress: 'AllowSameNamespace' })
    );

    const { result } = renderHook(() => useInfoTab(defaultProject));

    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.handleFormDataChange({ ingress: 'DenyAll' });
    });
    expect(result.current.hasChanges).toBe(true);

    act(() => {
      result.current.handleFormDataChange({ ingress: 'AllowSameNamespace' });
    });
    expect(result.current.hasChanges).toBe(false);
  });

  // --- Validation ---

  test('validation is valid on initial form population', async () => {
    const { result } = renderHook(() => useInfoTab(defaultProject));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.validation.isValid).toBe(true);
  });

  test('validation becomes invalid when cpuRequest exceeds cpuLimit', async () => {
    const { result } = renderHook(() => useInfoTab(defaultProject));

    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.handleFormDataChange({ cpuRequest: 2000, cpuLimit: 500 });
    });

    expect(result.current.validation.isValid).toBe(false);
    expect(result.current.validation.errors).toContain(
      'CPU requests cannot be greater than CPU limits'
    );
  });

  test('validation becomes invalid when memoryRequest exceeds memoryLimit', async () => {
    const { result } = renderHook(() => useInfoTab(defaultProject));

    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.handleFormDataChange({ memoryRequest: 1024, memoryLimit: 256 });
    });

    expect(result.current.validation.isValid).toBe(false);
  });

  // --- handleSave ---

  test('handleSave calls updateManagedNamespace with correct arguments and advances baseline', async () => {
    mockUpdateManagedNamespace.mockResolvedValue(undefined);

    const { result } = renderHook(() => useInfoTab(defaultProject));

    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.handleFormDataChange({ ingress: 'DenyAll' });
    });

    expect(result.current.hasChanges).toBe(true);

    await act(async () => {
      await result.current.handleSave();
    });

    expect(mockUpdateManagedNamespace).toHaveBeenCalledWith(
      expect.objectContaining({
        clusterName: 'my-cluster',
        resourceGroup: 'rg-prod',
        namespaceName: 'my-project',
        ingressPolicy: 'DenyAll',
      })
    );
    expect(result.current.hasChanges).toBe(false);
  });

  test('handleSave invalidates the cache on success', async () => {
    mockUpdateManagedNamespace.mockResolvedValue(undefined);

    const { result } = renderHook(() => useInfoTab(defaultProject));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(detailsCache.has('my-cluster/my-project')).toBe(true);

    act(() => {
      result.current.handleFormDataChange({ ingress: 'DenyAll' });
    });

    await act(async () => {
      await result.current.handleSave();
    });

    expect(detailsCache.has('my-cluster/my-project')).toBe(false);
  });

  test('handleSave sets error and leaves updating false when updateManagedNamespace throws', async () => {
    mockUpdateManagedNamespace.mockRejectedValue(new Error('update failed'));

    const { result } = renderHook(() => useInfoTab(defaultProject));

    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.handleFormDataChange({ ingress: 'DenyAll' });
    });

    await act(async () => {
      await result.current.handleSave();
    });

    expect(result.current.error).toBe('Failed to update managed namespace');
    expect(result.current.updating).toBe(false);
  });

  test('handleSave clears a previous error on success', async () => {
    mockUpdateManagedNamespace.mockRejectedValueOnce(new Error('update failed'));
    mockUpdateManagedNamespace.mockResolvedValueOnce(undefined);

    const { result } = renderHook(() => useInfoTab(defaultProject));

    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.handleFormDataChange({ ingress: 'DenyAll' });
    });

    await act(async () => {
      await result.current.handleSave();
    });

    expect(result.current.error).toBe('Failed to update managed namespace');

    act(() => {
      result.current.handleFormDataChange({ ingress: 'AllowAll' });
    });

    await act(async () => {
      await result.current.handleSave();
    });

    expect(result.current.error).toBeNull();
    expect(mockUpdateManagedNamespace).toHaveBeenCalledTimes(2);
  });

  test('handleSave is a no-op when resourceGroup label is absent', async () => {
    mockUseGet.mockReturnValue([{ jsonData: { metadata: { labels: {} } } }]);

    const { result } = renderHook(() => useInfoTab(defaultProject));

    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.handleSave();
    });

    expect(mockUpdateManagedNamespace).not.toHaveBeenCalled();
  });
});
