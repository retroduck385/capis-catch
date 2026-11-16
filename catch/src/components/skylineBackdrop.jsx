// Decorative backdrop for every signed-in page: big isometric (3D) glass towers drawn in outline, spanning the
// viewport behind the content (the glass cards blur them). Each tower is a box with a lit left face, a shaded right
// face and a top, with floor lines and window columns on both faces. A fainter back row stands behind a front row.
// Colours and strengths are set in applicantTheme.css (.ct-skyline); aria-hidden, no pointer events.

const C = 0.866; // cos 30deg
const S = 0.5;   // sin 30deg

const pt = ([x, y], dy = 0) => `${x},${y - dy}`;
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

// One isometric box. (x, y) = front-bottom corner; w runs up-left, d runs up-right, h is the height.
// floors / cols draw the window grid on both visible faces.
const IsoBox = ({ x, y, w, d, h, floors = 0, cols = 0 }) => {
    const F = [x, y];
    const L = [x - w * C, y - w * S];
    const R = [x + d * C, y - d * S];
    const B = [L[0] + d * C, L[1] - d * S];
    const grid = [];
    for (let i = 1; i < floors; i += 1) {
        const dy = (h * i) / floors;
        grid.push(<line key={`fl${i}`} x1={F[0]} y1={F[1] - dy} x2={L[0]} y2={L[1] - dy} />);
        grid.push(<line key={`fr${i}`} x1={F[0]} y1={F[1] - dy} x2={R[0]} y2={R[1] - dy} />);
    }
    for (let j = 1; j < cols; j += 1) {
        const t = j / cols;
        const a = lerp(F, L, t);
        const b = lerp(F, R, t);
        grid.push(<line key={`cl${j}`} x1={a[0]} y1={a[1]} x2={a[0]} y2={a[1] - h} />);
        grid.push(<line key={`cr${j}`} x1={b[0]} y1={b[1]} x2={b[0]} y2={b[1] - h} />);
    }
    return (
        <g>
            <polygon className='face-l edge' points={`${pt(F)} ${pt(L)} ${pt(L, h)} ${pt(F, h)}`} />
            <polygon className='face-r edge' points={`${pt(F)} ${pt(R)} ${pt(R, h)} ${pt(F, h)}`} />
            <polygon className='face-t edge' points={`${pt(F, h)} ${pt(L, h)} ${pt(B, h)} ${pt(R, h)}`} />
            <g className='grid'>{grid}</g>
        </g>
    );
};

// A tower with an optional crown (a smaller box on the roof). No bare antenna lines: with see-through faces a
// lone line on the roof reads as a stray stroke piercing the building.
const Tower = ({ x, y, w, d, h, floors, cols, crown }) => (
    <g>
        <IsoBox x={x} y={y} w={w} d={d} h={h} floors={floors} cols={cols} />
        {/* the crown stands on the tower's front corner, smaller, so it sits inside the roof */}
        {crown && (
            <IsoBox x={x} y={y - h} w={crown.w} d={crown.d} h={crown.h} floors={crown.floors ?? 0} cols={crown.cols ?? 0} />
        )}
    </g>
);

const SkylineBackdrop = () => (
    <svg
        className='ct-skyline'
        viewBox='0 0 1600 1000'
        preserveAspectRatio='xMidYMax slice'
        aria-hidden='true'
        focusable='false'>
        <g fill='none' strokeWidth='1.2' strokeLinejoin='round' strokeLinecap='round'>
            {/* back row: very tall, fainter */}
            <g className='back'>
                <Tower x={200} y={930} w={120} d={90} h={760} floors={30} cols={4} />
                <Tower
                    x={590} y={930} w={100} d={120} h={850} floors={34} cols={3}
                    crown={{ w: 55, d: 65, h: 45, floors: 2 }} />
                <Tower x={1030} y={930} w={130} d={100} h={700} floors={28} cols={5} />
                <Tower x={1440} y={930} w={110} d={110} h={820} floors={32} cols={4} />
            </g>

            {/* front row: shorter, stronger, overlapping the back */}
            <g className='front'>
                <Tower x={70} y={1000} w={90} d={140} h={430} floors={14} cols={3} />
                <Tower
                    x={380} y={1000} w={140} d={100} h={600} floors={22} cols={5}
                    crown={{ w: 80, d: 60, h: 90, floors: 3, cols: 2 }} />
                <Tower
                    x={780} y={1000} w={110} d={150} h={520} floors={18} cols={4}
                    crown={{ w: 60, d: 80, h: 55, floors: 2, cols: 2 }} />
                <Tower
                    x={1200} y={1000} w={150} d={90} h={640} floors={24} cols={5}
                    crown={{ w: 100, d: 60, h: 110, floors: 4, cols: 3 }} />
                <Tower x={1560} y={1000} w={100} d={120} h={460} floors={16} cols={3} />
            </g>
        </g>
    </svg>
);

export default SkylineBackdrop;
