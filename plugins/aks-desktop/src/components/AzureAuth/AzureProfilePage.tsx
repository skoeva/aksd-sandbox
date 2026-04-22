// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Icon, InlineIcon } from '@iconify/react';
import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import {
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Container,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import React from 'react';
import { useAzureProfilePage } from './hooks/useAzureProfilePage';

/**
 * Azure Profile page.
 *
 * Displays the logged-in user's Azure account details and provides actions to
 * add a cluster or log out. Redirects to `/azure/login` when the user is not
 * authenticated.
 *
 * All stateful logic (auth state, logout flow, navigation, redirect guard)
 * lives in {@link useAzureProfilePage}.
 */
export default function AzureProfilePage() {
  const { t } = useTranslation();
  const theme = useTheme();
  const {
    isChecking,
    isLoggedIn,
    username,
    tenantId,
    subscriptionId,
    loggingOut,
    handleBack,
    handleAddCluster,
    handleLogout,
  } = useAzureProfilePage();

  if (isChecking) {
    return (
      <Box
        sx={{
          minHeight: '100vh',
          backgroundColor: theme.palette.background.default,
          pt: 2,
        }}
      >
        <Container maxWidth="sm">
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              minHeight: '50vh',
            }}
          >
            <CircularProgress />
            <Typography variant="body1" sx={{ mt: 2 }}>
              {t('Loading Azure account information')}...
            </Typography>
          </Box>
        </Container>
      </Box>
    );
  }

  // Don't render anything if not logged in (will redirect)
  if (!isLoggedIn) {
    return null;
  }

  return (
    <Box
      sx={{
        minHeight: '100vh',
        backgroundColor: theme.palette.background.default,
        pt: 2,
      }}
    >
      <Container maxWidth="sm">
        {/* Back Button */}
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 3 }}>
          <Box
            onClick={handleBack}
            role="button"
            sx={{
              display: 'flex',
              alignItems: 'center',
              cursor: 'pointer',
              color: theme.palette.text.secondary,
              '&:hover': {
                color: theme.palette.primary.main,
              },
            }}
          >
            <Box pt={0.5}>
              <InlineIcon icon="mdi:chevron-left" height={20} width={20} />
            </Box>
            <Box fontSize={14} sx={{ textTransform: 'uppercase' }}>
              {t('Back')}
            </Box>
          </Box>
        </Box>

        <Card sx={{ textAlign: 'center', p: 4 }}>
          <CardContent>
            <Box
              component={Icon}
              icon="logos:microsoft-azure"
              sx={{
                fontSize: 64,
                color: 'primary.main',
                mb: 2,
                display: 'inline-block',
              }}
            />

            <Typography variant="h4" sx={{ mb: 1, fontWeight: 600 }}>
              {t('Azure Account')}
            </Typography>

            <Typography variant="body1" sx={{ mb: 3, color: theme.palette.text.secondary }}>
              {t('Logged in as')} <strong>{username}</strong>
            </Typography>

            {tenantId && (
              <Box
                sx={{
                  mb: 3,
                  p: 2,
                  backgroundColor: theme.palette.action.hover,
                  borderRadius: theme.shape.borderRadius,
                  textAlign: 'left',
                }}
              >
                <Typography
                  variant="caption"
                  sx={{
                    fontWeight: 600,
                    mb: 0.5,
                    color: theme.palette.text.secondary,
                  }}
                >
                  Tenant ID
                </Typography>
                <Typography variant="body2" sx={{ fontSize: '1rem', wordBreak: 'break-all' }}>
                  {tenantId}
                </Typography>
              </Box>
            )}

            {subscriptionId && (
              <Box
                sx={{
                  mb: 3,
                  p: 2,
                  backgroundColor: theme.palette.action.hover,
                  borderRadius: theme.shape.borderRadius,
                  textAlign: 'left',
                }}
              >
                <Typography
                  variant="caption"
                  sx={{
                    fontWeight: 600,
                    mb: 0.5,
                    color: theme.palette.text.secondary,
                  }}
                >
                  Default Subscription ID
                </Typography>
                <Typography variant="body2" sx={{ fontSize: '1rem', wordBreak: 'break-all' }}>
                  {subscriptionId}
                </Typography>
              </Box>
            )}

            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 3 }}>
              <Button
                variant="contained"
                color="primary"
                onClick={handleAddCluster}
                startIcon={<Icon icon="mdi:cloud-plus" />}
                sx={{ p: 1.5, textTransform: 'none', fontSize: 16 }}
              >
                {t('Add Cluster from Azure')}
              </Button>

              <Button
                variant="outlined"
                color="primary"
                onClick={handleLogout}
                disabled={loggingOut}
                startIcon={loggingOut ? <CircularProgress size={20} /> : <Icon icon="mdi:logout" />}
                sx={{ p: 1.5, textTransform: 'none', fontSize: 16 }}
              >
                {loggingOut ? `${t('Logging out')}...` : t('Log out')}
              </Button>
            </Box>
          </CardContent>
        </Card>
      </Container>
    </Box>
  );
}
