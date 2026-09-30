import React from "react";
import { UserAuth } from "../context/authContext";
import { Navigate } from "react-router-dom";
import { homePathFor } from "../roles";

// roles (optional): only these user_role values may open the page, e.g. ['APPLICANT']; others go to their own home
const PrivateRoute = ({ children, roles }) => {
    const { session, role } = UserAuth();

    if (session == undefined){
        return <p> Loading... </p>;
    }
    if (!session){
        return <Navigate to = "/signUpPage"/>;
    }
    if (roles){
        if (role === undefined) return <p> Loading... </p>;
        if (!role) return <p> Your account has no role yet. Please contact an administrator. </p>;
        // wrong role -> send them to their own home page
        if (!roles.includes(role)) return <Navigate to = {homePathFor(role)} replace />;
    }
    return <> {children} </>;

};

export default PrivateRoute;
