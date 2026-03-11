// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { CircularProgress, FormControl, InputLabel, MenuItem, Select } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';
import React from 'react';

interface DeploymentSelectorProps {
  selectedDeployment: string;
  deployments: Array<{ name: string }>;
  loading?: boolean;
  onDeploymentChange: (deploymentName: string) => void;
  sx?: SxProps<Theme>;
}

/**
 * Dropdown selector for choosing a deployment
 */
export const DeploymentSelector: React.FC<DeploymentSelectorProps> = ({
  selectedDeployment,
  deployments,
  loading = false,
  onDeploymentChange,
  sx,
}) => {
  const { t } = useTranslation();

  return (
    <FormControl
      sx={[{ minWidth: 200 }, ...(Array.isArray(sx) ? sx : sx ? [sx] : [])]}
      size="small"
      variant="outlined"
    >
      <InputLabel>{t('Select Deployment')}</InputLabel>
      <Select
        value={selectedDeployment || ''}
        onChange={e => onDeploymentChange(e.target.value as string)}
        label={t('Select Deployment')}
        disabled={loading || deployments.length === 0}
      >
        {loading ? (
          <MenuItem disabled>
            <CircularProgress size={16} style={{ marginRight: 8 }} />
            {t('Loading deployments')}...
          </MenuItem>
        ) : deployments.length === 0 ? (
          <MenuItem disabled>{t('No deployments found')}</MenuItem>
        ) : (
          deployments.map(deployment => (
            <MenuItem key={deployment.name} value={deployment.name}>
              {deployment.name}
            </MenuItem>
          ))
        )}
      </Select>
    </FormControl>
  );
};
