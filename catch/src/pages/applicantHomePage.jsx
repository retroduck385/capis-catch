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
            navigate('/loginPage');
        } catch (err){
            console.error(err);
        }
    };

    const applyHousingLoan = async (e) => {
        e.preventDefault()
        console.log('clicked') // delete when deploying 
        try{
            navigate('/applicationFormPage');
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
                className='hover:cursor-pointer border inline-block px-4 py-3 mt-4'> 
                    Signout
                </p>
            </div>

            <div className='py-3'>
                <p 
                onClick={applyHousingLoan}
                className='hover:cursor-pointer border inline-block px-4 py-3 mt-4'> 
                    Apply Housing Loan
                </p>
            </div>

        </div>
    ) 
};

export default ApplicantHomePage;