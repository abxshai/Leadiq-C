import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

// Sign the user out and clear the Supabase auth cookies.
//
// IMPORTANT: the cleared-cookie Set-Cookie headers must be attached to the
// SAME response object we return. The previous version created the client
// via createServerSupabase() (which writes through the next/headers cookies()
// store) and then returned a separately-constructed NextResponse.redirect() —
// Next doesn't reliably merge the store's mutations onto a custom response, so
// the auth cookies survived and the "sign out" did nothing. We mirror the
// cookie-on-response pattern from proxy.ts instead.
export async function POST(request: NextRequest) {
  const response = NextResponse.redirect(new URL("/login", request.url), {
    status: 303,
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(all) {
          all.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  await supabase.auth.signOut();
  return response;
}
