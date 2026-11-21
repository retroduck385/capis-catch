// Scrolls the window to the top on every route change. RootLayout wraps all routes so it fires on every navigation.
import { useEffect } from 'react';
import { useLocation, Outlet } from 'react-router-dom';

function ScrollToTop() {
    const { pathname } = useLocation();
    useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
    return null;
}

export default function RootLayout() {
    return <><ScrollToTop /><Outlet /></>;
}
