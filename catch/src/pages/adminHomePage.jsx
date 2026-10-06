import { UserAuth } from '../context/authContext';
import { useNavigate } from 'react-router-dom';
import WorkTray from './workTray/workTray';

// Home for all staff roles (AO, CI, Dispatch Admin, CO, Reviewer, Approver, Dept Head): the work tray
const AdminHomePage = () => {
    const { session, role, signOut } = UserAuth();
    const navigate = useNavigate();

    const handleSignOut = async (e) => {
        e.preventDefault()
        try{
            await signOut();
            navigate('/loginPage');
        } catch (err){
            console.error(err);
        }
    };

    return (
        <div>
            <h1> Admin Home Page </h1>
            <h2> Welcome, {session?.user?.email} ({role})</h2>

            <div>
                <p
                onClick={handleSignOut}
                className='hover:cursor-pointer border inline-block px-4 py-3 mt-4'>
                    Signout
                </p>
                <p
                onClick={() => navigate('/staffProfilePage')}
                className='hover:cursor-pointer border inline-block px-4 py-3 mt-4 ml-2'>
                    My Profile
                </p>
            </div>

            {role === 'ACCOUNT_OFFICER' && (
                <div>
                    <p
                    onClick={() => navigate('/accountOfficerApplicationInputPage')}
                    className='hover:cursor-pointer border inline-block px-4 py-3 mt-4'>
                        Create Application
                    </p>
                </div>
            )}

            <div className='py-3'>
                <WorkTray />
            </div>
        </div>
    )
};

export default AdminHomePage;
