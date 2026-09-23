import { createBrowserRouter, Navigate } from "react-router";

// Panel de administración
import CreateUserPage from "@/admin/pages/users/CreateUserPage";
import EditUserPage from "@/admin/pages/users/EditUserPage";
import { UsersPage } from "@/admin/pages/users/UsersPage";
import OverviewPage from "@/app/pages/dashboard/OverviewPage";
import UserDevicesPage from "@/app/pages/devices/UserDevicesPage";
import FormerDevicesPage from "@/app/pages/devices/FormerDevicesPage";
import FormerDeviceHistoryPage from "@/app/pages/devices/FormerDeviceHistoryPage";
import PairDevicePage from "@/app/pages/devices/PairDevicePage";
import DeviceDetailPage from "@/app/pages/devices/DeviceDetailPage";
import DeviceOperationsPage from "@/app/pages/devices/DeviceOperationsPage";
import MapPage from "@/app/pages/dashboard/MapPage";
import { EnvironmentsPage } from "@/app/pages/environments/EnvironmentsPage";
import { CreateEnvironmentPage } from "@/app/pages/environments/CreateEnvironmentPage";
import DevicesPage from "@/app/pages/devices/DevicesPage";
import CreateDevicePage from "@/app/pages/devices/CreateDevicePage";
import EditDevicePage from "@/app/pages/devices/EditDevicePage";

// Autenticación
import { LoginPage } from "../auth/pages/login/LoginPage";
import { RegisterPage } from "../auth/pages/register/RegisterPage";
import { ResetPasswordPage } from "../auth/pages/reset/ResetPasswordPage";
import { VerifyEmailPage } from "../auth/pages/verify/VerifyEmailPage";
import { SocialCallbackPage } from "../auth/pages/SocialCallbackPage";

// Rutas protegidas
import { AdminRoute, AuthenticatedRoute } from "./routes/ProtectedRoutes";

// Aplicación
import { ChangePasswordPage } from "@/app/pages/profile/ChangePasswordPage";
import { ProfilePage } from "@/app/pages/profile/ProfilePage";

// Layouts
import MainLayout from "@/app/layouts/MainLayout";

import { MessagesPage } from "@/app/pages/messages/MessagesPage";
import { NotificationsPage } from "@/app/pages/notifications/NotificationsPage";
import { PermissionsPage } from "@/admin/pages/permissions/PermissionsPage";
import AuthLayout from "@/auth/layouts/AuthLayout";

import CreateCountryPage from "@/admin/pages/settings/location/CreateCountryPage";
import EditCountryPage from "@/admin/pages/settings/location/EditCountryPage";
import CreateStatePage from "@/admin/pages/settings/location/CreateStatePage";
import EditStatePage from "@/admin/pages/settings/location/EditStatePage";
import CreateCityPage from "@/admin/pages/settings/location/CreateCityPage";
import EditCityPage from "@/admin/pages/settings/location/EditCityPage";
import CountriesPage from "@/admin/pages/settings/location/CountriesPage";
import StatesPage from "@/admin/pages/settings/location/StatesPage";
import CitiesPage from "@/admin/pages/settings/location/CitiesPage";
import IdentificationTypesPage from "@/admin/pages/settings/identification/IdentificationTypesPage";
import { CreateIdentificationTypePage } from "@/admin/pages/settings/identification/CreateIdentificationTypePage";
import { EditIdentificationTypePage } from "@/admin/pages/settings/identification/EditIdentificationTypePage";
import EnvironmentTypesPage from "@/admin/pages/settings/environment/EnvironmentTypesPage";
import { CreateEnvironmentTypePage } from "@/admin/pages/settings/environment/CreateEnvironmentTypePage";
import { EditEnvironmentTypePage } from "@/admin/pages/settings/environment/EditEnvironmentTypePage";

// Invitaciones (Standalone Authenticated)
import InvitationAcceptPage from "@/app/invitations/InvitationAcceptPage";

export const appRouter = createBrowserRouter([
  // Ruta raíz - entrada a la aplicación
  {
    path: "/",
    element: <Navigate to="/auth/login" replace />,
  },

  {
    // Rutas de la aplicación (autenticadas)
    path: "/app",
    element: (
      <AuthenticatedRoute>
        <MainLayout />
      </AuthenticatedRoute>
    ),
    children: [
      {
        index: true,
        element: <OverviewPage />,
      },
      {
        path: "environments",
        children: [
          {
            index: true,
            element: <EnvironmentsPage />,
          },
          {
            path: "create",
            element: <CreateEnvironmentPage />,
          },
          {
            path: ":id/edit",
            element: <CreateEnvironmentPage />,
          },
        ],
      },
      {
        path: "devices",
        children: [
          { path: "history", element: <FormerDevicesPage /> },
          { path: "history/:serial", element: <FormerDeviceHistoryPage /> },
          {
            index: true,
            element: <UserDevicesPage />,
          },
          {
            path: "pair",
            element: <PairDevicePage />,
          },
          {
            path: ":id/operations",
            element: <DeviceOperationsPage />,
          },
          {
            path: ":id/edit",
            element: <EditDevicePage mode="user" />,
          },
          {
            path: ":id",
            element: <DeviceDetailPage />,
          },
        ],
      },
      {
        path: "map",
        element: <MapPage />,
      },
      {
        path: "profile",
        element: <ProfilePage />,
      },
      {
        path: "change-password",
        element: <ChangePasswordPage />,
      },
      {
        path: "notifications",
        element: <NotificationsPage />,
      },
      {
        path: "messages",
        element: <MessagesPage />,
      },
    ],
  },

  // Invitaciones (Autenticadas fuera del Layout principal)
  {
    path: "invitations/accept",
    element: <InvitationAcceptPage />,
  },

  // Rutas de autenticación
  {
    path: "auth",
    element: <AuthLayout />,
    children: [
      {
        index: true,
        element: <Navigate to="/auth/login" />,
      },
      {
        path: "login",
        element: <LoginPage />,
      },
      {
        path: "register",
        element: <RegisterPage />,
      },
      {
        path: "verify-email",
        element: <VerifyEmailPage />,
      },
      {
        path: "reset-password",
        element: <ResetPasswordPage />,
      },
      {
        path: "social-callback",
        element: <SocialCallbackPage />,
      },
    ],
  },

  // Rutas de Panel de administración
  {
    path: "/admin",
    element: (
      <AdminRoute>
        <MainLayout />
      </AdminRoute>
    ),
    children: [
      {
        index: true,
        element: <Navigate to="/admin/users" />,
      },
      {
        path: "users",
        children: [
          {
            index: true,
            element: <UsersPage />,
          },
          {
            path: "create",
            element: <CreateUserPage />,
          },
          {
            path: "edit/:id",
            element: <EditUserPage />,
          },
        ],
      },
      {
        path: "locations",
        children: [
          {
            path: "countries",
            children: [
              { index: true, element: <CountriesPage /> },
              { path: "create", element: <CreateCountryPage /> },
              { path: "edit/:id", element: <EditCountryPage /> },
            ],
          },
          {
            path: "states",
            children: [
              { index: true, element: <StatesPage /> },
              { path: "create", element: <CreateStatePage /> },
              { path: "edit/:id", element: <EditStatePage /> },
            ],
          },
          {
            path: "cities",
            children: [
              { index: true, element: <CitiesPage /> },
              { path: "create", element: <CreateCityPage /> },
              { path: "edit/:id", element: <EditCityPage /> },
            ],
          },
        ],
      },
      {
        path: "identification-types",
        children: [
          {
            index: true,
            element: <IdentificationTypesPage />,
          },
          { path: "create", element: <CreateIdentificationTypePage /> },
          { path: "edit/:id", element: <EditIdentificationTypePage /> },
        ],
      },
      {
        path: "environments",
        children: [
          { path: "types", element: <EnvironmentTypesPage /> },
          { path: "types/create", element: <CreateEnvironmentTypePage /> },
          { path: "types/edit/:id", element: <EditEnvironmentTypePage /> },
        ],
      },
      {
        path: "devices",
        children: [
          { path: "history", element: <FormerDevicesPage /> },
          { path: "history/:serial", element: <FormerDeviceHistoryPage /> },
          {
            index: true,
            element: <DevicesPage />,
          },
          {
            path: "create",
            element: <CreateDevicePage />,
          },
          {
            path: ":id/edit",
            element: <EditDevicePage />,
          },
        ],
      },
      {
        path: "permissions",
        element: <PermissionsPage />,
      },
    ],
  },
  // Si no se encuentra la ruta, redirige al login de la aplicación
  {
    path: "*",
    element: <Navigate to="/auth/login" replace />,
  },
]);
