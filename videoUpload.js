// Video upload functionality

export const uploadWithRetry = async (file, maxRetries = 3, baseDelay = 1000, setUploadProgress) => {
    let lastError;
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            setUploadProgress({ 
                progress: 80 + (attempt * 5), 
                status: attempt > 0 ? `Retrying upload (${attempt + 1}/${maxRetries})...` : 'Uploading video...' 
            });
            
            const result = await websim.upload(file);
            
            // Validate the result
            if (!result) {
                throw new Error('Upload returned null or undefined');
            }
            
            if (typeof result !== 'string') {
                throw new Error('Upload returned non-string result');
            }
            
            // Check if result is HTML error page instead of URL
            if (result.trim().startsWith('<') || result.includes('<!DOCTYPE')) {
                throw new Error('Upload service returned HTML error page instead of URL');
            }
            
            // Validate URL format
            if (!result.startsWith('http://') && !result.startsWith('https://')) {
                throw new Error(`Invalid URL format received: ${result.substring(0, 50)}`);
            }
            
            return result;
            
        } catch (error) {
            lastError = error;
            console.log(`Upload attempt ${attempt + 1} failed:`, error.message);
            
            // Don't retry on the last attempt
            if (attempt === maxRetries - 1) {
                break;
            }
            
            // Calculate delay with exponential backoff, longer delay for HTML errors
            const delay = baseDelay * Math.pow(2, attempt) * (error.message.includes('HTML') ? 2 : 1);
            console.log(`Waiting ${delay}ms before retry...`);
            
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    
    // All retries failed, throw the last error
    throw new Error(`Upload failed after ${maxRetries} attempts. Last error: ${lastError.message}`);
};

export const createDatabaseRecord = async (videoData, maxRetries = 3, setUploadProgress, room) => {
    let lastError;
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            setUploadProgress({ 
                progress: 90 + (attempt * 2), 
                status: attempt > 0 ? `Saving to database (retry ${attempt + 1}/${maxRetries})...` : 'Saving to database...' 
            });
            
            const record = await Promise.race([
                room.collection('video').create(videoData),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Database operation timed out')), 10000)
                )
            ]);
            
            return record;
            
        } catch (error) {
            lastError = error;
            console.log(`Database save attempt ${attempt + 1} failed:`, error.message);
            
            if (attempt === maxRetries - 1) {
                break;
            }
            
            const delay = 1000 * Math.pow(2, attempt);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    
    throw lastError;
};