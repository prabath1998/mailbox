<?php

namespace Tests\Concerns;

use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Http;

/**
 * Reads mail caught by MailBox in feature and Dusk tests.
 *
 * Send real mail to MailBox during tests by setting, in phpunit.xml or .env.testing:
 *   MAIL_MAILER=smtp  MAIL_HOST=127.0.0.1  MAIL_PORT=1025
 * Set MAILBOX_URL if the web UI isn't on http://localhost:8025, and MAILBOX_AUTH
 * ("user:pass") if MailBox was started with -ui-auth.
 */
trait InteractsWithMailBox
{
    protected function mailbox(): \Illuminate\Http\Client\PendingRequest
    {
        $request = Http::baseUrl(rtrim(env('MAILBOX_URL', 'http://localhost:8025'), '/').'/api')->acceptJson();
        if ($auth = env('MAILBOX_AUTH')) {
            [$user, $pass] = explode(':', $auth, 2);
            $request = $request->withBasicAuth($user, $pass);
        }

        return $request;
    }

    /** Delete every caught message, for a clean inbox at the start of a test. */
    protected function clearMailBox(): void
    {
        $this->mailbox()->delete('/messages')->throw();
    }

    /**
     * Wait for an email matching a MailBox search such as "to:ana@example.com subject:reset"
     * and return it as an array (subject, from, to, text, html, tags, ...).
     */
    protected function waitForEmail(string $query, int $timeoutSeconds = 15, ?Carbon $since = null): array
    {
        $since ??= now()->subSeconds(5);

        $response = $this->mailbox()
            ->timeout($timeoutSeconds + 5)
            ->get('/messages/wait', [
                'q' => $query,
                'since' => $since->getTimestampMs(),
                'timeout' => $timeoutSeconds,
            ]);

        $this->assertTrue($response->successful(), "No email matching \"{$query}\" arrived within {$timeoutSeconds}s.");

        return $response->json();
    }

    /** Links (url and text) and likely one-time codes found in an email, best guess first. */
    protected function extractFromEmail(array $email): array
    {
        return $this->mailbox()->get("/messages/{$email['id']}/extract")->throw()->json();
    }
}
