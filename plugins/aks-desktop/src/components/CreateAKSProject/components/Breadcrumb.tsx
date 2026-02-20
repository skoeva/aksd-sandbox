// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Icon } from '@iconify/react';
import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { Box, Typography } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import React from 'react';
import type { BreadcrumbProps } from '../types';

/**
 * Breadcrumb navigation component for multi-step forms
 */
export const Breadcrumb: React.FC<BreadcrumbProps> = ({ steps, activeStep, onStepClick }) => {
  const theme = useTheme();
  const { t } = useTranslation();

  return (
    <Box
      role="navigation"
      aria-label={t('Wizard steps')}
      sx={{
        width: '100%',
        borderBottom: `1px solid ${theme.palette.divider}`,
        display: 'flex',
        flexDirection: 'row',
        justifyContent: 'flex-start',
        alignItems: 'center',
        // @ts-ignore todo: fix this
        backgroundColor: theme.palette.background.muted,
        px: 3,
        py: 2,
      }}
    >
      {steps.map((label, index) => (
        <React.Fragment key={index}>
          <Box
            role="button"
            tabIndex={0}
            aria-current={index === activeStep ? 'step' : undefined}
            onClick={() => onStepClick(index)}
            onKeyDown={e => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onStepClick(index);
              }
            }}
            sx={{
              display: 'flex',
              alignItems: 'center',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              '&:hover': { opacity: 0.8 },
            }}
          >
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                mr: 2,
              }}
            >
              <Icon
                icon={
                  index === activeStep
                    ? `mdi:numeric-${index + 1}-circle`
                    : `mdi:numeric-${index + 1}-circle-outline`
                }
                width={24}
                height={24}
                color={index === activeStep ? 'primary.main' : 'text.secondary'}
              />
            </Box>

            <Typography
              variant="body1"
              sx={{
                color: index === activeStep ? 'primary.main' : 'text.secondary',
                fontWeight: index === activeStep ? 'bold' : 'normal',
                textDecoration: index === activeStep ? 'underline' : 'none',
                textUnderlineOffset: index === activeStep ? '4px' : undefined,
              }}
            >
              {label}
            </Typography>
          </Box>

          {index < steps.length - 1 && (
            <Typography variant="body1" sx={{ mx: 2, color: 'text.secondary' }}>
              &gt;
            </Typography>
          )}
        </React.Fragment>
      ))}
    </Box>
  );
};
