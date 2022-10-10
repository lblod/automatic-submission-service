import process from 'node:process';

export const AUTOMATIC_SUBMISSION_JSON_LD_CONTEXT_ENDPOINT =
  process.env.AUTOMATIC_SUBMISSION_JSON_LD_CONTEXT_ENDPOINT ||
  'https://lblod.data.gift/contexts/automatische-melding/v1/context.json';

export const BASIC_AUTH =
  'https://www.w3.org/2019/wot/security#BasicSecurityScheme';
export const OAUTH2 =
  'https://www.w3.org/2019/wot/security#OAuth2SecurityScheme';
