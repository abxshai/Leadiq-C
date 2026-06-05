// Static ASCII art for the login hero. Rendered pixel-perfect; a CSS
// animation streams white→grey→black bands downward through the glyphs via
// background-clip: text. Keyframes live in src/app/globals.css under
// .animate-hero-stream.
const PATTERN = `

                                        .'..''"<[/xvvr|[<:''''''
                                        ..'^<JMMWMWWWWMMWW*J}I^.
                                        .':bWBMWMmr//vwMWWMWMMWx^''.
                                        .{oWW#jI\`.'....',I_z*WWW#Z>'
                                    ...;CMWMk~''...... .....^~cMMWMQ!...
                                    .,t*WMMv"''.            ''.Ic#MW#j".
                            .. ....;t*WMMZ>.....            ....'l0MMWk~....
                            .. .';cWMWMb_'..                    '..}#WBM)'..
                            ...\`C#BMMdi'..'.                    '''',kMM#<..
                            ''>aMWWCi\`''                            .]WWWj..
                            .,aMM*-''.''                            .1WMWt..
                            .fMMW)..                            ....IaMW*;..
                            .0MMW,..                            ..'laMWM}...
                            .QMMM"..                        ... ..}MMWW-
                            .YMWMI..                        ...."QMWWki.
                            .cMWMi..                        ...{hMWMv,.'
                            .tMMM[..                        'IQMMWb_....
                            .]MWMt..                    ...\`1#MW#v^'.'..
                            .;WMWC..                    .\`:ZMMMhi'..
                            '.kWM*'.                    .}#WWMx\`.'..
                            ..vWWW+.                ..'\`YMWMh>''
                            ..~WWMz'                '.,ZMMWz,.\`.
                            ..'dMW#;                ."mWMMj.
                            .'.)WMMx                'QMWMt'.
                                bB#BI..'        ..'.tMWMX'..
                                +WWMw'..        .'.<MMWb^.'.
                                'xWWWn'.        .'\`pMWM>....
                                .\`QWWWr\`        ..rMWMr.
                                .'\`0MWWY, .... ..+MWMp''
                                ..'.zWWW*]^'....l*WM*!..
                                ..'.'+#MMWoY_^^t#MWM+'..
                                    .'")kBMWWMMWMWbi
                                    ....\`~/Ymkkmz]^'

                                                                                              `;

export function LoginHero() {
  return (
    <pre
      aria-hidden
      className="animate-hero-stream text-[10px] sm:text-[12px] md:text-[14px] leading-[1] font-mono whitespace-pre select-none"
    >
      {PATTERN}
    </pre>
  );
}
