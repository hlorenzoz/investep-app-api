/**
 * Dominio: AUTH — autenticación y gestión de sesión (apoyado en Supabase Auth).
 *
 * Endpoints HTTP en `auth.router.ts` (`GET /auth/me`, protegido por `requireAuth`).
 * Esta barrera re-exporta el router y la superficie de aprovisionamiento.
 */
export { authRouter } from "./auth.router";
export type {
  ChangePasswordDeps,
  ChangePasswordInput,
  ChangePasswordResult,
} from "./change-password";

// Cambio de contraseña iniciado por el usuario (apaga must_reset_password en app_metadata).
export { changePassword } from "./change-password";
// Metadata keys compartidas entre el aprovisionamiento (write) y el middleware (read).
export { MUST_RESET_PASSWORD_KEY } from "./metadata";
// Provisioning surface — CLI scripts and external callers import from this boundary
export { generatePassword } from "./password";
export { MIN_PASSWORD_LENGTH, validatePasswordPolicy } from "./password-policy";
export type { CredentialEmailInput, CredentialEmailOutput } from "./templates";
export { credentialEmail } from "./templates";
export type {
  ProvisionUserDeps,
  ProvisionUserInput,
  ProvisionUserResult,
} from "./user-provisioning";
export { provisionUser } from "./user-provisioning";
