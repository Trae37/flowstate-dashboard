// Script to create a test user in the FlowState Dashboard database
// Run with: node create-test-user.js

import { initDatabase, prepare } from './dist/main/database.js';
import { createUser } from './dist/main/auth.js';

async function createTestUser() {
  try {
    console.log('Initializing database...');
    await initDatabase();
    
    console.log('Creating test user...');
    const result = await createUser(
      'test@example.com',
      'testpassword123',
      'testuser'
    );
    
    if (result.success) {
      console.log('\n✅ Test user created successfully!');
      console.log('\nLogin credentials:');
      console.log('Email: test@example.com');
      console.log('Password: testpassword123');
      console.log('Username: testuser');
    } else {
      console.error('❌ Failed to create test user:', result.error);
    }
  } catch (error) {
    console.error('Error:', error);
  }
}

createTestUser();

