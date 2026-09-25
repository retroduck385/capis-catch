import React, {useState} from 'react';
import { UserAuth } from '../context/authContext';
import { Link, useNavigate } from 'react-router-dom';

const SignInPage = () => {
    const [email, setEmail] = useState ("");
    const [password, setPassword] = useState ("");
    const [error, setError] = useState (null);
    const [loading, setLoading] = useState (false);

    const { session, signInUser } = UserAuth();
    const navigate = useNavigate();

    console.log(session); // delete when deploying
    console.log(email, password); // delete when deploying
    
    const handleSignIn = async (e) => {
    e.preventDefault()
    setLoading(true)
    try{
        const result = await signInUser(email, password)

        if(result.success){
            navigate('/applicationHomepage')
        } else {
            setError(result.error.message)
        }
    } catch (err){
        console.error(err) // delete this after 
        setError ("an error occured");
    } finally {
        setLoading(false);
    }
    }

    return(
    <div> 
        <form onSubmit={ handleSignIn } className = "max-w-md m-auto pt-24">
            <h2> Login here! </h2>
            <p> Don't have an account? <Link to ="/signUpPage"> Sign up!</Link></p>

            <div className= "flex flex-col py-4">
                <input 
                onChange={(e) => setEmail(e.target.value)} 
                placeholder = "Email" 
                className="p-3 mt-2 bg-black" 
                type = "email"
                />
                <input 
                onChange={(e) => setPassword(e.target.value)} 
                placeholder = "Password" 
                className="p-3 mt-2 bg-black" 
                type = "password"
                />
            </div>
            <button type = "submit" disabled = {loading} className="p-3 mt-2 bg-black"> 
                Login 
            </button>
            {error && <p className="text-red-600 text-center pt-4">{error}</p>}
        </form>
    </div>
);
};

export default SignInPage;