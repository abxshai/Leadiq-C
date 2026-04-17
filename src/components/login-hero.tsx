// Static ASCII art for the login hero. Rendered pixel-perfect; a subtle
// CSS breathing animation (opacity + brightness) keeps it feeling alive
// without disturbing the character grid. Animation keyframes live in
// src/app/globals.css under .animate-hero-breathe.
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
      className="animate-hero-breathe text-[7px] sm:text-[8px] md:text-[9px] leading-[1] text-primary font-mono whitespace-pre select-none"
    >
      {PATTERN}
    </pre>
  );
}
