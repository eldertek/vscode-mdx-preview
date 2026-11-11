import { SecurityPolicy } from './security';

const NO_CSP = '';

export function getCSP(
  securityConfiguration: {
    securityPolicy: SecurityPolicy;
  },
  cspSource = 'vscode-resource:'
) {
  const { securityPolicy } = securityConfiguration;
  if (securityPolicy === SecurityPolicy.Strict) {
    return `default-src 'none'; connect-src ${cspSource} https:; img-src ${cspSource} https: data: blob:; script-src ${cspSource} 'unsafe-inline' 'unsafe-eval'; style-src ${cspSource} 'unsafe-inline' http: https: data:; font-src ${cspSource} https: data:;`;
  }
  if (securityPolicy === SecurityPolicy.Disabled) {
    return NO_CSP;
  }
  return `default-src 'none'; connect-src ${cspSource} https:; img-src ${cspSource} https: data: blob:; script-src ${cspSource} 'unsafe-inline' 'unsafe-eval'; style-src ${cspSource} 'unsafe-inline' http: https: data:; font-src ${cspSource} https: data:;`;
}
