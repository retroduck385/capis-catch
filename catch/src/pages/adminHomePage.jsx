import { UserAuth } from '../context/authContext';
import { useNavigate } from 'react-router-dom';

// Placeholder home for all staff roles (AO, CI, Dispatch Admin, CO, Reviewer, Approver, Dept Head)
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
            </div>
        </div>
    )
};

export default AdminHomePage;
