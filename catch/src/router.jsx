import { createBrowserRouter, Navigate } from "react-router-dom";
import App from "./App";
import SignUpPage from "./pages/signUpPage";
import LoginPage from "./pages/loginPage";
import ApplicantHomePage from "./pages/applicantHomePage";
import PrivateRoute from "./components /privateRoute";

export const router = createBrowserRouter([
    { path: "/", element: <Navigate to="/LoginPage" replace /> },
    { path: "/signUpPage", element: <SignUpPage /> },
    { path: "/loginPage", element: <LoginPage /> },

    // add <PrivateRoute> for private pages 
    { path: "/applicationHomePage", element: <PrivateRoute><ApplicantHomePage /> </PrivateRoute>},
]);