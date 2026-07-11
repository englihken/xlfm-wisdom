// src/lib/locales/index.ts
// Dictionary aggregator: merges the core zh/en/id dictionaries with the
// per-surface part files under ./parts (one per swept surface). Each part is a
// self-contained trilingual bundle whose en/id are typed Record<keyof typeof zh,
// string>, so a missing key in any part is a compile error. i18n.ts imports the
// MERGED dictionaries from here (never the individual files), so every t('<ns>.*')
// resolves. Add a new surface by dropping a part into ./parts and spreading it here.

import { zh as zhCore } from './zh';
import { en as enCore } from './en';
import { id as idCore } from './id';

import { loginPart } from './parts/login';
import { cockpitPart } from './parts/cockpit';
import { carePart } from './parts/care';
import { inboxuiPart } from './parts/inboxui';
import { durenPart } from './parts/duren';

export const zh = {
  ...zhCore,
  ...loginPart.zh,
  ...cockpitPart.zh,
  ...carePart.zh,
  ...inboxuiPart.zh,
  ...durenPart.zh,
};

export const en = {
  ...enCore,
  ...loginPart.en,
  ...cockpitPart.en,
  ...carePart.en,
  ...inboxuiPart.en,
  ...durenPart.en,
};

export const id = {
  ...idCore,
  ...loginPart.id,
  ...cockpitPart.id,
  ...carePart.id,
  ...inboxuiPart.id,
  ...durenPart.id,
};
