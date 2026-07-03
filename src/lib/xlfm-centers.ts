// src/lib/xlfm-centers.ts
// The 心灵法门 (Guan Yin Citta) care centers in Malaysia, grouped by state
// (source: xlfm.my/contact-us). Used to render the 所属中心 dropdown (<optgroup>
// per state) and to validate the submitted value server-side.
//
// The stored value is the full bilingual label (e.g. "总会 HQ"). Legacy free-text
// center values from before this dropdown still display as-is; they simply won't
// preselect in the dropdown (which only offers these canonical values or blank).

export type XlfmCenterGroup = { state: string; centers: string[] };

export const XLFM_CENTERS: XlfmCenterGroup[] = [
  { state: '吉隆坡', centers: ['总会 HQ', '蕉赖 Cheras'] },
  {
    state: '雪兰莪',
    centers: ['蒲种 Puchong', '八打灵再也 Petaling Jaya', '巴生 Klang', '瓜拉雪兰莪 Kuala Selangor'],
  },
  {
    state: '柔佛',
    centers: [
      '古来 Kulai',
      '士姑来 Skudai',
      '乌鲁地南 Ulu Tiram',
      '峇株巴辖 Batu Pahat',
      '永平 Yong Peng',
      '麻坡 Muar',
      '昔加末 Segamat',
      '居銮 Kluang',
    ],
  },
  {
    state: '东海岸',
    centers: ['关丹 Kuantan', '而连突 Jerantut', '瓜拉登嘉楼 Kuala Terengganu', '哥打巴鲁 Kota Bharu'],
  },
  { state: '马六甲', centers: ['马六甲 Melaka'] },
  { state: '吉打', centers: ['亚罗士打 Alor Setar', '双溪大年 Sungai Petani'] },
  { state: '森美兰', centers: ['芙蓉 Seremban'] },
  { state: '霹雳', centers: ['怡保 Ipoh', '安顺 Teluk Intan', '实兆远 Sitiawan', '太平 Taiping'] },
  { state: '沙巴', centers: ['亚庇 Kota Kinabalu', '山打根 Sandakan', '斗湖 Tawau'] },
  { state: '砂拉越', centers: ['古晋 Kuching', '诗巫 Sibu', '美里 Miri'] },
  { state: '槟城', centers: ['威南 Simpang Ampat', '槟岛 Bayan Lepas', '北海 Butterworth'] },
];

// Flat list of every valid center value, for server-side validation.
export const XLFM_CENTER_VALUES: readonly string[] = XLFM_CENTERS.flatMap((g) => g.centers);

export function isValidCenter(value: string): boolean {
  return XLFM_CENTER_VALUES.includes(value);
}
