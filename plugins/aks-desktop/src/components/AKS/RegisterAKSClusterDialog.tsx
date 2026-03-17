// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import React, { useEffect, useRef, useState } from 'react';
import { useHistory } from 'react-router-dom';
import { useAzureAuth } from '../../hooks/useAzureAuth';
import type { ClusterCapabilities } from '../../types/ClusterCapabilities';
import { getAKSClusters, getSubscriptions, registerAKSCluster } from '../../utils/azure/aks';
import { getClusterCapabilities } from '../../utils/azure/az-cli';
import type { AKSCluster, Subscription } from './RegisterAKSClusterDialogPure';
import RegisterAKSClusterDialogPure from './RegisterAKSClusterDialogPure';

interface RegisterAKSClusterDialogProps {
  open: boolean;
  onClose: () => void;
  onClusterRegistered?: () => void;
}

export default function RegisterAKSClusterDialog({
  open,
  onClose,
  onClusterRegistered,
}: RegisterAKSClusterDialogProps) {
  const history = useHistory();
  const { t } = useTranslation();
  const authStatus = useAzureAuth();
  const [loading, setLoading] = useState(false);
  const [loadingSubscriptions, setLoadingSubscriptions] = useState(false);
  const [loadingClusters, setLoadingClusters] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [selectedSubscription, setSelectedSubscription] = useState<Subscription | null>(null);
  const [clusters, setClusters] = useState<AKSCluster[]>([]);
  const [selectedCluster, setSelectedCluster] = useState<AKSCluster | null>(null);
  const [capabilities, setCapabilities] = useState<ClusterCapabilities | null>(null);
  const [capabilitiesLoading, setCapabilitiesLoading] = useState(false);
  const isMountedRef = useRef(true);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (open && authStatus.isLoggedIn) {
      loadSubscriptions();
    }
  }, [open, authStatus.isLoggedIn]);

  useEffect(() => {
    if (selectedSubscription) {
      loadClusters(selectedSubscription.id);
    } else {
      setClusters([]);
      setSelectedCluster(null);
    }
  }, [selectedSubscription]);

  const loadSubscriptions = async () => {
    setLoadingSubscriptions(true);
    setError('');

    try {
      const result = await getSubscriptions();

      if (!result.success) {
        setError(result.message);
        return;
      }

      setSubscriptions(result.subscriptions || []);

      // Auto-select if only one subscription
      if (result.subscriptions && result.subscriptions.length === 1) {
        setSelectedSubscription(result.subscriptions[0]);
      }
    } catch (err) {
      console.error('Error loading subscriptions:', err);
      setError(t('Failed to load subscriptions'));
    } finally {
      setLoadingSubscriptions(false);
    }
  };

  const loadClusters = async (subscriptionId: string) => {
    setLoadingClusters(true);
    setError('');
    setClusters([]);
    setSelectedCluster(null);

    try {
      const result = await getAKSClusters(subscriptionId);

      if (!result.success) {
        setError(result.message);
        return;
      }

      setClusters(result.clusters || []);
    } catch (err) {
      console.error('Error loading AKS clusters:', err);
      setError(t('Failed to load AKS clusters'));
    } finally {
      setLoadingClusters(false);
    }
  };

  const handleSubscriptionChange = (event: React.SyntheticEvent, value: Subscription | null) => {
    setSelectedSubscription(value);
  };

  const handleClusterChange = (event: React.SyntheticEvent, value: AKSCluster | null) => {
    setSelectedCluster(value);
  };

  const handleRegister = async () => {
    if (!selectedCluster || !selectedSubscription) {
      return;
    }

    setLoading(true);
    setError('');
    setSuccess('');

    try {
      // Register the cluster by running az aks get-credentials and setting up kubeconfig
      const result = await registerAKSCluster(
        selectedSubscription.id,
        selectedCluster.resourceGroup,
        selectedCluster.name
      );

      if (!result.success) {
        setError(result.message);
        setLoading(false);
        return;
      }

      setLoading(false);

      // Show success message with cluster name
      setSuccess(
        t("Cluster '{{cluster}}' successfully merged in kubeconfig", {
          cluster: selectedCluster.name,
        })
      );

      onClusterRegistered?.();

      // Check cluster capabilities (non-blocking)
      setCapabilitiesLoading(true);
      try {
        const caps = await getClusterCapabilities({
          subscriptionId: selectedSubscription.id,
          resourceGroup: selectedCluster.resourceGroup,
          clusterName: selectedCluster.name,
        });
        if (isMountedRef.current) {
          setCapabilities(caps);
        }
      } catch {
        // Non-critical — just don't show capabilities
      } finally {
        if (isMountedRef.current) {
          setCapabilitiesLoading(false);
        }
      }
    } catch (err) {
      console.error('Error registering AKS cluster:', err);
      setError(
        t('Failed to register cluster: {{message}}', {
          message: err instanceof Error ? err.message : t('Unknown error'),
        })
      );
      setLoading(false);
    }
  };

  const handleClose = () => {
    if (!loading) {
      onClose();
    }
  };

  const handleDone = () => {
    onClose();
    history.replace('/');
    window.location.reload();
  };

  const handleConfigured = () => {
    if (selectedSubscription && selectedCluster) {
      getClusterCapabilities({
        subscriptionId: selectedSubscription.id,
        resourceGroup: selectedCluster.resourceGroup,
        clusterName: selectedCluster.name,
      })
        .then(caps => {
          if (isMountedRef.current) {
            setCapabilities(caps);
          }
        })
        .catch(() => {});
    }
  };

  return (
    <RegisterAKSClusterDialogPure
      open={open}
      isChecking={authStatus.isChecking}
      isLoggedIn={authStatus.isLoggedIn}
      loading={loading}
      loadingSubscriptions={loadingSubscriptions}
      loadingClusters={loadingClusters}
      capabilitiesLoading={capabilitiesLoading}
      error={error}
      success={success}
      subscriptions={subscriptions}
      selectedSubscription={selectedSubscription}
      clusters={clusters}
      selectedCluster={selectedCluster}
      capabilities={capabilities}
      onClose={handleClose}
      onSubscriptionChange={handleSubscriptionChange}
      onClusterChange={handleClusterChange}
      onRegister={handleRegister}
      onDone={handleDone}
      onDismissError={() => setError('')}
      onDismissSuccess={() => setSuccess('')}
      onConfigured={handleConfigured}
    />
  );
}
