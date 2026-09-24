import React, {useState} from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { UserAuth } from '../context/authContext';

const SignUpPage = () => {
const [email, setEmail] = useState ("");
const [password, setPassword] = useState ("");
const [error, setError] = useState (null);
const [loading, setLoading] = useState (false);

const { session, signUpNewUser, signOut, signInUser } = UserAuth();
const navigate = useNavigate();

console.log(session);
console.log(email, password); // to remove both console logs

const handleSignUp = async (e) => {
    e.preventDefault()
    setLoading(true)
    try{
        const result = await signUpNewUser(email, password)

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
        <form onSubmit={ handleSignUp } className = "max-w-md m-auto pt-24">
            <h2> Sign Up here! </h2>
            <p> already have an account? <Link to ="/signInPage"> Sign in!</Link></p>

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
                Sign up 
            </button>
            {error && <p className="text-red-600 text-center pt-4">{error}</p>}
        </form>
    </div>
); 
};

export default SignUpPage;