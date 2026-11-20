import { createContext, useEffect, useState, useContext } from "react";
import { supabase } from "../supabaseClient";

const AuthContext = createContext()

export const AuthContextProvider = ({children}) => {
    const [session, setSession] = useState(undefined)
    const [loadedRole, setLoadedRole] = useState({ userId: null, role: null })

    // Sign up 
    const signUpNewUser = async (email, password) => {
        const { data, error } = await supabase.auth.signUp({
            email: email,
            password: password,
        });

        if(error){
            console.error("There was a problem signing up", error);
            return{ success: false, error}
        }
        return { success: true, data };
    }

    // Sign in
    const signInUser = async (email, password) => {
        try{
            const { data, error } = await supabase.auth.signInWithPassword({
                email: email,
                password: password,
            });
            if(error){
                console.error("sign in error occured: ", error);
                return {success: false, error: error.message};
            }

            console.log("sign-in success: ", data) //remove when deploying
            return {success: true, data};

        } catch(error){
            console.error("an error occured: ", error)
        }
    }

    useEffect(() => {
        supabase.auth.getSession().then(({data: { session }}) =>{
            setSession(session);
        });

        supabase.auth.onAuthStateChange((_event, session) =>{
            setSession(session);
        })

    },[]);

    // Role comes from public.users (set to APPLICANT by the sign-up trigger)
    const userId = session?.user?.id;
    useEffect(() => {
        if (!userId) return;
        let cancelled = false;
        supabase.from('users').select('role').eq('id', userId).maybeSingle()
            .then(({ data, error }) => {
                if (error) console.error("could not load user role", error);
                if (!cancelled) setLoadedRole({ userId, role: data?.role ?? null });
            });
        return () => { cancelled = true; };
    }, [userId]);

    // AO / CO Manager flag (20261120_team_managers_auto_assignment.sql). Loaded on its own, so a database
    // without that migration still loads the role; false until it arrives or when the column is missing.
    const [loadedManager, setLoadedManager] = useState({ userId: null, isManager: false })
    useEffect(() => {
        if (!userId) return;
        let cancelled = false;
        supabase.from('users').select('is_manager').eq('id', userId).maybeSingle()
            .then(({ data }) => {
                if (!cancelled) setLoadedManager({ userId, isManager: data?.is_manager === true });
            });
        return () => { cancelled = true; };
    }, [userId]);
    const isManager = loadedManager.userId === userId && loadedManager.isManager;

    // undefined = still loading, null = signed out / no role
    const role = session === undefined ? undefined
        : !userId ? null
        : loadedRole.userId === userId ? loadedRole.role : undefined;

    // Sign out 
    const signOut = () => {
        const { error } = supabase.auth.signOut();
        if(error){
            console.error("there was an error", error);
        }
    };

    return(
        <AuthContext.Provider value={{session, role, isManager, signUpNewUser, signOut, signInUser}}>
            {children}
        </AuthContext.Provider>
    )
}

export const UserAuth = () => {
    return useContext(AuthContext);
}