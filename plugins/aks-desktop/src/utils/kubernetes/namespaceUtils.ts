// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { K8s } from '@kinvolk/headlamp-plugin/lib';
import type { ApiClient } from '@kinvolk/headlamp-plugin/lib/lib/k8s/api/v1/factories';
import type { KubeNamespace } from '@kinvolk/headlamp-plugin/lib/lib/k8s/namespace';
import {
  PROJECT_ID_LABEL,
  PROJECT_MANAGED_BY_LABEL,
  PROJECT_MANAGED_BY_VALUE,
  RESOURCE_GROUP_LABEL,
  SUBSCRIPTION_LABEL,
} from '../constants/projectLabels';

/**
 * Fetches a namespace object via the Headlamp K8s API.
 */
export function fetchNamespaceData(name: string, cluster: string): Promise<KubeNamespace> {
  return new Promise((resolve, reject) => {
    const cancelFn = (K8s.ResourceClasses.Namespace.apiEndpoint as ApiClient<KubeNamespace>).get(
      name,
      ns => {
        cancelFn.then(cancel => cancel());
        resolve(ns);
      },
      (err: any) => {
        cancelFn.then(cancel => cancel());
        reject(new Error(`Failed to fetch namespace: ${err}`));
      },
      {},
      cluster
    );
  });
}

/**
 * Applies AKS Desktop project labels to an existing namespace via the K8s API.
 * This converts a managed namespace into a Headlamp project.
 */
export async function applyProjectLabels(options: {
  namespaceName: string;
  clusterName: string;
  subscriptionId: string;
  resourceGroup: string;
}): Promise<void> {
  const { namespaceName, clusterName, subscriptionId, resourceGroup } = options;

  const nsData = await fetchNamespaceData(namespaceName, clusterName);

  const updatedData = { ...nsData };
  updatedData.metadata = { ...updatedData.metadata };
  updatedData.metadata.labels = {
    ...updatedData.metadata.labels,
    [PROJECT_ID_LABEL]: namespaceName,
    [PROJECT_MANAGED_BY_LABEL]: PROJECT_MANAGED_BY_VALUE,
    // Only set Azure metadata labels when values are available (managed namespaces).
    // Regular K8s namespaces don't have subscription/resource-group info.
    ...(subscriptionId ? { [SUBSCRIPTION_LABEL]: subscriptionId } : {}),
    ...(resourceGroup ? { [RESOURCE_GROUP_LABEL]: resourceGroup } : {}),
  };

  await K8s.ResourceClasses.Namespace.apiEndpoint.put(updatedData, {}, clusterName);
}
