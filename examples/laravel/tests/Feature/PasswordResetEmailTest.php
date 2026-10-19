<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\Concerns\InteractsWithMailBox;
use Tests\TestCase;

class PasswordResetEmailTest extends TestCase
{
    use InteractsWithMailBox, RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->clearMailBox();
    }

    public function test_the_reset_email_links_to_a_working_reset_page(): void
    {
        $user = User::factory()->create(['email' => 'ana@example.com']);

        $this->post('/forgot-password', ['email' => $user->email])->assertSessionHasNoErrors();

        $email = $this->waitForEmail('to:ana@example.com subject:"Reset Password"');
        $this->assertSame('Reset Password Notification', $email['subject']);

        $links = collect($this->extractFromEmail($email)['links']);
        $reset = $links->first(fn ($link) => Str::contains($link['url'], '/reset-password/'));
        $this->assertNotNull($reset, 'The email has no password reset link.');

        $this->get($reset['url'])->assertOk()->assertSee('Reset Password');
    }
}
