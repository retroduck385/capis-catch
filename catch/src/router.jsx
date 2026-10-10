import { createBrowserRouter, Navigate } from "react-router-dom";
import PrivateRoute from "./components /privateRoute";
import App from "./App";
import SignUpPage from "./pages/signUpPage";
import LoginPage from "./pages/loginPage";
import ApplicantHomePage from "./pages/applicantHomePage";
import ApplicationFormPage from "./pages/applicationFormPage";
import ProfilePage from "./pages/profilePage";
import AdminHomePage from "./pages/adminHomePage";
import AccountOfficerApplicationInputPage from "./pages/accountOfficerApplicationInputPage";
import HomeRedirect from "./components /homeRedirect";
import StaffProfileGate from "./components /staffProfileGate";
import StaffProfilePage from "./pages/staffProfilePage";
import StaffAccountsPage from "./pages/staffAccounts/staffAccountsPage";
import LoanFolderPage from "./pages/loanFolder/loanFolderPage";
import { STAFF_ROLES } from "./roles";


export const router = createBrowserRouter([
    { path: "/", element: <Navigate to="/LoginPage" replace /> },
    { path: "/signUpPage", element: <SignUpPage /> },
    { path: "/loginPage", element: <LoginPage /> },

    // add <PrivateRoute> for private pages 
    { path: "/homePage", element: <PrivateRoute><HomeRedirect /></PrivateRoute>},
    { path: "/adminHomePage", element: <PrivateRoute roles={STAFF_ROLES}><StaffProfileGate><AdminHomePage /></StaffProfileGate> </PrivateRoute>},
    { path: "/loanFolderPage", element: <PrivateRoute roles={STAFF_ROLES}><StaffProfileGate><LoanFolderPage /></StaffProfileGate> </PrivateRoute>},
    { path: "/staffAccountsPage", element: <PrivateRoute roles={["DEPT_HEAD"]}><StaffProfileGate><StaffAccountsPage /></StaffProfileGate> </PrivateRoute>},
    { path: "/staffProfilePage", element: <PrivateRoute roles={STAFF_ROLES}><StaffProfilePage /> </PrivateRoute>},
    { path: "/accountOfficerApplicationInputPage", element: <PrivateRoute roles={["ACCOUNT_OFFICER"]}><StaffProfileGate><AccountOfficerApplicationInputPage /></StaffProfileGate> </PrivateRoute>},
    { path: "/applicantHomePage", element: <PrivateRoute roles={["APPLICANT"]}><ApplicantHomePage /> </PrivateRoute>},
    { path: "/applicationFormPage", element: <PrivateRoute roles={["APPLICANT"]}><ApplicationFormPage /> </PrivateRoute>},
    { path: "/profilePage", element: <PrivateRoute roles={["APPLICANT"]}><ProfilePage /> </PrivateRoute>},

]);