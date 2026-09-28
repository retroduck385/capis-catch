import React, { useEffect, useState } from 'react';
import { UserAuth } from '../context/authContext';
import { Link, useNavigate } from 'react-router-dom';
import { listMyApplications } from './applicationForm/api';

const ApplicantHomePage = () => {
    const { session, signOut } = UserAuth();
    const navigate = useNavigate(); 
    const [applications, setApplications] = useState([]);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (!session?.user?.id) return;
        listMyApplications(session.user.id)
            .then(setApplications)
            .catch((err) => setError(err.message));
    }, [session?.user?.id]);

    const hasDraft = applications.some((a) => a.status === 'DRAFT');

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
                    {hasDraft ? 'Continue Housing Loan Application' : 'Apply Housing Loan'}
                </p>
            </div>

            <div className='py-3'>
                <h2> My Applications </h2>
                {error && <p className="text-red-600">{error}</p>}
                {applications.length === 0 && <p> No applications yet. </p>}
                <ul>
                    {applications.map((a) => (
                        <li key={a.id}>
                            {a.application_no ?? 'Draft'} | {a.status}
                            {a.loan_amount ? ` | PHP ${Number(a.loan_amount).toLocaleString()}` : ''}
                            {' '}
                            <Link className='underline' to={`/applicationFormPage?id=${a.id}`}>
                                {a.status === 'DRAFT' ? 'Continue' : 'View'}
                            </Link>
                        </li>
                    ))}
                </ul>
            </div>

        </div>
    ) 
};

export default ApplicantHomePage;