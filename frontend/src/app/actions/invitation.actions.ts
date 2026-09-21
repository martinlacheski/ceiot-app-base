import { appApi } from "@/api/appApi";
import axios from "axios";
import { API_BASE_URL } from "@/lib/apiBaseUrl";

const publicApi = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: false,
});

export interface InvitationDetails {
  id: string;
  email: string;
  status: string;
  environment_name: string;
  environmentName?: string;
  scope_name?: string;
  scopeName?: string;
  scope_type?: "environment" | "device";
  scopeType?: "environment" | "device";
  scope_id?: string;
  scopeId?: string;
  owner_email: string;
  ownerEmail?: string;
  environment_id: string;
  environmentId?: string;
  is_active: boolean;
  isActive?: boolean;
  invited_user_exists?: boolean;
  invitedUserExists?: boolean;
}

export const getInvitationAction = async (
  id: string
): Promise<InvitationDetails> => {
  const { data } = await publicApi.get<InvitationDetails>(
    `/access/invitations/${id}`
  );
  return data;
};

export const declineInvitationAction = async (
  id: string
): Promise<{ message: string }> => {
  const { data } = await appApi.post<{ message: string }>(
    `/access/invitations/${id}/decline`
  );
  return data;
};

export const acceptInvitationAction = async (
  id: string
): Promise<{ message: string }> => {
  const { data } = await appApi.post<{ message: string }>(
    `/access/invitations/${id}/accept`
  );
  return data;
};
