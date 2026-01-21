const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://fgpjqkjdpdophfzahumq.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZncGpxa2pkcGRvcGhmemFodW1xIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg5MjM5MzUsImV4cCI6MjA4NDQ5OTkzNX0.S-iOQWzllZaHicCDUgBleb9R_ClXzfeDqBxkGUWSIx8';

const supabase = createClient(supabaseUrl, supabaseKey);

module.exports = supabase;
