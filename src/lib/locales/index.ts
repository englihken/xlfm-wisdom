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
// E4 sweep-3 surfaces
import { membersPart } from './parts/members';
import { eventsPart } from './parts/events';
import { inventoryPart } from './parts/inventory';
import { financePart } from './parts/finance';
// 财务 v2 Phase 1 — 账户 + 流水 cash book
import { cashbookPart } from './parts/cashbook';
// 财务 v2 Phase 2 — 仪表板 dashboard + 报表 finance pie
import { financeDashPart } from './parts/financedash';
// 活动签到 Phase 1 — 签到台 desk + the attendee's personal QR
import { checkinPart } from './parts/checkin';
// 活动收款 Phase 1 — 费用分配 · 分会收款板 · 现场收款/日结 · 总会对账
import { eventPayPart } from './parts/eventpay';
import { publicFormsPart } from './parts/publicforms';
import { settingsPart } from './parts/settings';
// E4 sweep-3 shared display-vocabulary + chip/relative-time maps
import { inboxVocabPart } from './parts/inboxvocab';
import { financeVocabPart } from './parts/financevocab';
import { eventsVocabPart } from './parts/eventsvocab';

export const zh = {
  ...zhCore,
  ...loginPart.zh,
  ...cockpitPart.zh,
  ...carePart.zh,
  ...inboxuiPart.zh,
  ...durenPart.zh,
  ...membersPart.zh,
  ...eventsPart.zh,
  ...inventoryPart.zh,
  ...financePart.zh,
  ...cashbookPart.zh,
  ...financeDashPart.zh,
  ...checkinPart.zh,
  ...eventPayPart.zh,
  ...publicFormsPart.zh,
  ...settingsPart.zh,
  ...inboxVocabPart.zh,
  ...financeVocabPart.zh,
  ...eventsVocabPart.zh,
};

export const en = {
  ...enCore,
  ...loginPart.en,
  ...cockpitPart.en,
  ...carePart.en,
  ...inboxuiPart.en,
  ...durenPart.en,
  ...membersPart.en,
  ...eventsPart.en,
  ...inventoryPart.en,
  ...financePart.en,
  ...cashbookPart.en,
  ...financeDashPart.en,
  ...checkinPart.en,
  ...eventPayPart.en,
  ...publicFormsPart.en,
  ...settingsPart.en,
  ...inboxVocabPart.en,
  ...financeVocabPart.en,
  ...eventsVocabPart.en,
};

export const id = {
  ...idCore,
  ...loginPart.id,
  ...cockpitPart.id,
  ...carePart.id,
  ...inboxuiPart.id,
  ...durenPart.id,
  ...membersPart.id,
  ...eventsPart.id,
  ...inventoryPart.id,
  ...financePart.id,
  ...cashbookPart.id,
  ...financeDashPart.id,
  ...checkinPart.id,
  ...eventPayPart.id,
  ...publicFormsPart.id,
  ...settingsPart.id,
  ...inboxVocabPart.id,
  ...financeVocabPart.id,
  ...eventsVocabPart.id,
};
