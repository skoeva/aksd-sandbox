// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { K8s } from '@kinvolk/headlamp-plugin/lib';

/** Checks if the given project is an AKS desktop managed namespace project  */
export const isAksProject = ({
  project,
}: {
  project: { namespaces: string[]; clusters: string[] };
}) =>
  new Promise(resolve => {
    K8s.ResourceClasses.Namespace.apiEndpoint.get(
      project.namespaces[0],
      // @ts-ignore todo: not sure what the issue is here.
      ns => {
        resolve(ns.metadata.labels['headlamp.dev/project-managed-by'] === 'aks-desktop');
      },
      () => {
        resolve(false);
      },
      {},
      project.clusters[0]
    );
  });
