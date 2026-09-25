import React from 'react';
import { UserAuth } from '../context/authContext';
import { useNavigate } from 'react-router-dom';

const ApplicantHomePage = () => {
    const { session, signOut } = UserAuth();
    const navigate = useNavigate(); 

    console.log(session); // Delete when deploying

    const handleSignOut = async (e) => {
        e.preventDefault()
        try{
            await signOut();
            navigate('/signUpPage');
        } catch (err){
            console.error(err);
        }
    };

    return (
        <div>
            <h1> Applicant Home Page </h1>
            <h2> Welcome, {session?.user?.email}</h2> 

            <div>
                <p 
                onClick={handleSignOut}
                className='hover:cursor-pointer border inline-block px-4 py-3. mt-4'> 
                    Signout
                </p>
            </div>

        </div>
    ) 
};

export default ApplicantHomePage;