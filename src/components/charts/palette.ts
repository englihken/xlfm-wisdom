// src/components/charts/palette.ts
// E3 binding visualization palette (brief §1 — dataviz-validated, do not alter).
// Vibrant colors are for DATA MARKS only; app chrome stays house gold.

// Categorical series, fixed order: emerald → azure → amber → violet.
export const CAT = ['#009E63', '#0E86D4', '#D97706', '#7C5CDB'] as const;
export const EMERALD = CAT[0];
export const AZURE = CAT[1];
export const AMBER = CAT[2];

// Neutral for the 其他 fold.
export const NEUTRAL = '#A79E8B';

// Rose is RESERVED for status/crisis — always icon+label, never color-alone.
export const ROSE = '#B04A4A';

// Emerald sequential ramp for the funnel (lightest → deepest). Ink text goes on
// the two lightest steps.
export const RAMP = ['#C6F2DF', '#7FE3B8', '#2FC488', '#009E63', '#00744A'] as const;

// Chart-internal ink + structure tokens (brief §1: values/labels always in ink).
export const INK = '#33302A';
export const INK_MUTED = '#948A76';
export const GRID = '#EEE8DB';
export const TRACK = '#F1EBDD';
