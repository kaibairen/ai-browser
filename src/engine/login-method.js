// Current visible login surface. Tab labels on the same page must not win.
export function loginMethodFromPageSignals({
  visibleQr = false,
  selectedTab = '',
  visiblePhoneField = false,
  visiblePasswordField = false,
  visibleUsernameField = false,
  pageText = '',
} = {}) {
  const tab = String(selectedTab || '');
  if (/扫码|二维码/.test(tab)) return '扫码';
  if (/短信|验证码|手机/.test(tab)) return 'phone';
  if (/密码|账号|帐号|用户名/.test(tab)) return visiblePhoneField ? 'phone' : 'username';
  if (visibleQr) return '扫码';
  if (visiblePhoneField) return 'phone';
  if (visibleUsernameField || visiblePasswordField) return 'username';

  const text = String(pageText || '');
  const hasVisibleCredentials = visiblePhoneField || visiblePasswordField || visibleUsernameField;
  if (/扫码登录|二维码/.test(text) && !hasVisibleCredentials) return '扫码';
  return '';
}
