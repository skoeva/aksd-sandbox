// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { TextField } from '@mui/material';
import { Box, MenuItem, Typography } from '@mui/material';
import React from 'react';
import type { NetworkingStepProps } from '../types';

/**
 * Networking step component for ingress and egress policy configuration
 */
export const NetworkingStep: React.FC<NetworkingStepProps> = ({
  formData,
  onFormDataChange,
  loading = false,
}) => {
  const { t } = useTranslation();
  const handleInputChange = (field: string, value: any) => {
    onFormDataChange({ [field]: value });
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Box>
        <Typography variant="h5" component="h2" gutterBottom>
          {t('Networking Policies')}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {t('Set security, communication and access rules for incoming and outgoing traffic')}
        </Typography>
      </Box>
      <TextField
        fullWidth
        variant="outlined"
        select
        value={formData.ingress}
        label={t('Ingress')}
        onChange={e => handleInputChange('ingress', e.target.value)}
        disabled={loading}
      >
        <MenuItem value="AllowSameNamespace">{t('Allow traffic within same namespace')}</MenuItem>
        <MenuItem value="AllowAll">{t('Allow all traffic')}</MenuItem>
        <MenuItem value="DenyAll">{t('Deny all traffic')}</MenuItem>
      </TextField>

      <TextField
        fullWidth
        variant="outlined"
        select
        value={formData.egress}
        label={t('Egress')}
        onChange={e => handleInputChange('egress', e.target.value)}
        disabled={loading}
      >
        <MenuItem value="AllowAll">{t('Allow all traffic')}</MenuItem>
        <MenuItem value="AllowSameNamespace">{t('Allow traffic within same namespace')}</MenuItem>
        <MenuItem value="DenyAll">{t('Deny all traffic')}</MenuItem>
      </TextField>
    </Box>
  );
};
