export const APP_ROLES = ['user', 'admin'] as const;
export type AppRole = (typeof APP_ROLES)[number];

export const USER_STATUSES = ['active', 'invited', 'inactive'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];
