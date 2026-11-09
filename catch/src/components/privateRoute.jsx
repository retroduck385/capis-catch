import { RouteSkeleton } from './skeleton';
import { UserAuth } from "../context/authContext";
import { Navigate } from "react-router-dom";
import { homePathFor } from "../roles";
import AppLayout from "./appLayout";

// roles (optional): only these user_role values may open the page, e.g. ['APPLICANT']; others go to their own home
const PrivateRoute = ({ children, roles }) => {
    const { session, role } = UserAuth();

    if (session == undefined){
        return <RouteSkeleton label="Loading" />;
    }
    if (!session){
        return <Navigate to = "/signUpPage"/>;
    }
    if (roles){
        if (role === undefined) return <RouteSkeleton label="Loading" />;
        if (!role) return <p> Your account has no role yet. Please contact an administrator. </p>;
        // wrong role -> send them to their own home page
        if (!roles.includes(role)) return <Navigate to = {homePathFor(role)} replace />;
    }
    // Everyone gets the sidebar layout (applicantTheme.css)
    return <AppLayout>{children}</AppLayout>;
};

export default PrivateRoute;
