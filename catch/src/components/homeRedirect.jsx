import { Navigate } from "react-router-dom";
import { UserAuth } from "../context/authContext";
import { homePathFor } from "../roles";

// Sends a signed-in user to their role's home page (wrap in <PrivateRoute>)
const HomeRedirect = () => {
    const { role } = UserAuth();

    if (role === undefined) return <p> Loading... </p>;
    if (!role) return <p> Your account has no role yet. Please contact an administrator. </p>;
    return <Navigate to={homePathFor(role)} replace />;
};

export default HomeRedirect;
