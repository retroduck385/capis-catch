import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { UserAuth } from "../context/authContext";
import { fetchProfile } from "../pages/applicationForm/api";
import { isProfileComplete } from "../pages/applicationForm/validators";

// Staff pages: sends the user to /staffProfilePage until their profile is complete (wrap inside <PrivateRoute>)
const StaffProfileGate = ({ children }) => {
    const { session } = UserAuth();
    const userId = session?.user?.id;
    const [complete, setComplete] = useState(undefined);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (!userId) return;
        fetchProfile(userId)
            .then((profile) => setComplete(isProfileComplete(profile, 'STAFF_PROFILE')))
            .catch((err) => setError(err.message));
    }, [userId]);

    if (error) return <p className="text-red-600"> {error} </p>;
    if (complete === undefined) return <p> Loading... </p>;
    if (!complete) return <Navigate to="/staffProfilePage" replace />;
    return <> {children} </>;
};

export default StaffProfileGate;
