// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

/**
 * Shared TypeScript interfaces for Azure resources
 *
 * This module contains all type definitions used across the Azure client modules
 * to avoid circular dependencies between client.ts and graph-api.ts
 */

// Types for Azure resources
export interface AzureTenant {
  id: string;
  name: string;
  domain: string;
  status: string;
}

export interface AzureSubscription {
  id: string;
  name: string;
  tenant: string;
  status: string;
  cost?: string;
}

export interface AzureResourceGroup {
  id: string;
  name: string;
  location: string;
  subscriptionId: string;
}

export interface AzureCluster {
  id: string;
  name: string;
  subscription: string;
  resourceGroup: string;
  location: string;
  version: string;
  status: string;
  nodeCount: number;
  vmSize: string;
}

export interface ContainerRegistry {
  id: string;
  name: string;
  resourceGroup: string;
  loginServer: string;
  location: string;
  sku: string;
}

export interface ContainerImage {
  id: string;
  name: string;
  repository: string;
  tag: string;
  registry: string;
  registryName: string;
  createdTime: string;
  size: string;
  digest: string;
}

// Interface for the Azure client
export interface AzureClient {
  getSubscriptions(): Promise<AzureSubscription[]>;
  getTenants(): Promise<AzureTenant[]>;
  getClusters(subscriptionId?: string): Promise<AzureCluster[]>;
  getResourceGroups(subscriptionId: string): Promise<AzureResourceGroup[]>;
  getContainerRegistries(subscriptionId: string): Promise<ContainerRegistry[]>;
  getContainerImages(subscriptionId: string, registryName?: string): Promise<ContainerImage[]>;
}
