// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import React from 'react';

export interface FormFieldProps {
  label: string;
  value: string | number;
  onChange: (value: string | number) => void;
  type?: 'text' | 'email' | 'number' | 'textarea';
  multiline?: boolean;
  rows?: number;
  placeholder?: string;
  error?: boolean;
  helperText?: string;
  disabled?: boolean;
  required?: boolean;
  startAdornment?: React.ReactNode;
  endAdornment?: React.ReactNode;
  /** Ref for the input element of this field */
  inputRef?: React.Ref<HTMLInputElement>;
}

export interface ResourceCardProps {
  title: string;
  icon: string;
  iconColor: string;
  children: React.ReactNode;
}

// Networking policy options
export const INGRESS_OPTIONS = [
  { value: 'AllowSameNamespace', label: 'Allow traffic within same namespace' },
  { value: 'AllowAll', label: 'Allow all traffic' },
  { value: 'DenyAll', label: 'Deny all traffic' },
] as const;

export const EGRESS_OPTIONS = [
  { value: 'AllowAll', label: 'Allow all traffic' },
  { value: 'AllowSameNamespace', label: 'Allow traffic within same namespace' },
  { value: 'DenyAll', label: 'Deny all traffic' },
] as const;
