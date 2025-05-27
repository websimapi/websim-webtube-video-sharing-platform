// Content moderation functionality

export const moderateContent = async (frames, setUploadProgress) => {
    setUploadProgress({ progress: 30, status: 'Analyzing content for safety...' });
    
    let overallRating = 'E'; // Start with Everyone rating
    const ratingHierarchy = ['E', 'E10+', 'T', 'M', '18+'];
    
    for (let i = 0; i < frames.length; i++) {
        try {
            const completion = await websim.chat.completions.create({
                messages: [{
                    role: "user",
                    content: [
                        {
                            type: "text",
                            text: `Analyze this video frame and provide a detailed description of what you see, then assign an age rating.

Age Rating Scale:
- E (Everyone): Suitable for all ages, no objectionable content
- E10+ (Everyone 10+): Mild cartoon violence or minimal suggestive themes
- T (Teen): Moderate violence, suggestive themes, mild language
- M (Mature 17+): Intense violence, sexual themes, strong language
- 18+ (Adults Only): Graphic violence, explicit sexual content, or other adult material

Respond with JSON only: {
  "description": "detailed description of what you see in the frame",
  "age_rating": "E|E10+|T|M|18+",
  "reasoning": "explanation for the age rating assigned"
}`
                        },
                        {
                            type: "image_url",
                            image_url: { url: frames[i] }
                        }
                    ]
                }],
                json: true
            });

            const result = JSON.parse(completion.content);
            console.log(`Frame ${i + 1} analysis:`, result);
            
            // Check if this frame got an 18+ rating
            if (result.age_rating === "18+") {
                throw new Error(`18+ content detected in frame ${i + 1}: ${result.reasoning}`);
            }
            
            // Update overall rating if this frame has a higher rating
            const currentIndex = ratingHierarchy.indexOf(result.age_rating);
            const overallIndex = ratingHierarchy.indexOf(overallRating);
            if (currentIndex > overallIndex) {
                overallRating = result.age_rating;
            }
            
            setUploadProgress({ 
                progress: 30 + (i + 1) / frames.length * 40, 
                status: `Analyzing frame ${i + 1}/${frames.length} (${result.age_rating})...` 
            });
        } catch (error) {
            throw new Error(error.message || 'Content moderation failed');
        }
    }
    
    console.log(`Video overall age rating: ${overallRating}`);
    return overallRating;
};