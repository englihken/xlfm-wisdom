// i18n part: dashboard login
const zh = {
  'login.subtitle': '登录',
  'login.emailLabel': '邮箱',
  'login.passwordLabel': '密码',
  'login.submit': '登录',
  'login.submitting': '登录中…',
  'login.errorInvalid': '登录失败，请检查邮箱和密码是否正确。',
  'login.errorConnection': '暂时无法连接，请稍后再试。',
  'login.footer': '一切免费结缘 · 菩萨慈悲 🙏',
};
export const loginPart: {
  zh: typeof zh;
  en: Record<keyof typeof zh, string>;
  id: Record<keyof typeof zh, string>;
} = {
  zh,
  en: {
    'login.subtitle': 'Log in',
    'login.emailLabel': 'Email',
    'login.passwordLabel': 'Password',
    'login.submit': 'Log in',
    'login.submitting': 'Logging in…',
    'login.errorInvalid':
      'Log in failed. Please check that your email and password are correct.',
    'login.errorConnection':
      'Unable to connect right now. Please try again shortly.',
    'login.footer': 'Everything offered freely · By the Bodhisattva’s compassion 🙏',
  },
  id: {
    'login.subtitle': 'Masuk',
    'login.emailLabel': 'Email',
    'login.passwordLabel': 'Kata sandi',
    'login.submit': 'Masuk',
    'login.submitting': 'Sedang masuk…',
    'login.errorInvalid':
      'Gagal masuk. Silakan periksa apakah email dan kata sandi Anda sudah benar.',
    'login.errorConnection':
      'Tidak dapat terhubung untuk saat ini. Silakan coba lagi nanti.',
    'login.footer': 'Semua diberikan gratis · Berkat welas asih Bodhisattva 🙏',
  },
};
