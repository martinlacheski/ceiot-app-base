export const isValidEmail = (email: string): boolean => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

export const isValidIdentification = (id: string): boolean => {
  return /^\d+$/.test(id);
};

export interface PasswordRequirements {
  hasUppercase: boolean;
  hasLowercase: boolean;
  hasNumber: boolean;
  hasLength: boolean;
}

export const getPasswordRequirements = (
  password: string
): PasswordRequirements => {
  return {
    hasUppercase: /[A-Z]/.test(password),
    hasLowercase: /[a-z]/.test(password),
    hasNumber: /\d/.test(password),
    hasLength: password.length >= 8,
  };
};

export const isPasswordStrong = (password: string): boolean => {
  const reqs = getPasswordRequirements(password);
  return Object.values(reqs).every(Boolean);
};
