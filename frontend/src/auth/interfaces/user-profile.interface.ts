export interface UserPasswordUpdate {
  old_password?: string;
  new_password: string;
  confirm_password: string;
}
