import { createBrowserRouter } from "react-router-dom";
import App from "./App";
import SignUpPage from "./pages/signUpPage";
import SignInPage from "./pages/signInPage";
import ApplicantHomePage from "./pages/applicantHomePage";

export const router = createBrowserRouter([
    { path: "/", element: <App /> },
    { path: "/signUpPage", element: <SignUpPage /> },
    { path: "/signInPage", element: <SignInPage /> },
    { path: "/applicationHomePage", element: <ApplicantHomePage /> },
]);