import { createBrowserRouter, Navigate } from "react-router-dom";
import PrivateRoute from "./components /privateRoute";
import App from "./App";
import SignUpPage from "./pages/signUpPage";
import LoginPage from "./pages/loginPage";
import ApplicantHomePage from "./pages/applicantHomePage";
import ApplicationFormPage from "./pages/applicationFormPage";


export const router = createBrowserRouter([
    { path: "/", element: <Navigate to="/LoginPage" replace /> },
    { path: "/signUpPage", element: <SignUpPage /> },
    { path: "/loginPage", element: <LoginPage /> },

    // add <PrivateRoute> for private pages 
    { path: "/applicantHomePage", element: <PrivateRoute><ApplicantHomePage /> </PrivateRoute>},
    { path: "/applicationFormPage", element: <PrivateRoute><ApplicationFormPage /> </PrivateRoute>},

]);