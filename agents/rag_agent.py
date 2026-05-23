import os
import glob
from google.antigravity import Agent, LocalAgentConfig
from google.antigravity.hooks import policy

def search_guidelines(query: str) -> str:
    """Searches clinical guidelines (NIH, CDC, WHO) for a query and returns matching sections.

    Args:
        query: The medical condition or drug keyword to search for, e.g. "heart failure", "pneumonia", "Metformin".
    """
    guidelines_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "guidelines")
    matches = []
    
    # Read all markdown files in the guidelines directory
    for path in glob.glob(os.path.join(guidelines_dir, "*.md")):
        filename = os.path.basename(path)
        try:
            with open(path, "r", encoding="utf-8") as f:
                content = f.read()
                
            # Basic matching (split by headers to return relevant sections)
            sections = content.split("\n## ")
            file_matches = []
            
            # Check title first
            if query.lower() in sections[0].lower():
                file_matches.append(sections[0])
                
            # Check sections
            for section in sections[1:]:
                if query.lower() in section.lower():
                    file_matches.append("## " + section)
                    
            if file_matches:
                matches.append(f"--- File: {filename} ---\n" + "\n\n".join(file_matches))
        except Exception as e:
            matches.append(f"Error reading guideline {filename}: {str(e)}")
            
    if not matches:
        return f"No clinical guidelines found matching query: '{query}'."
        
    return "\n\n".join(matches)

class RagAgent:
    def __init__(self, api_key: str = None):
        self.config = LocalAgentConfig(
            api_key=api_key,
            model="gemini-3.5-flash",
            system_instructions=(
                "You are a medical RAG (Retrieval-Augmented Generation) agent. "
                "Your job is to search the clinical guidelines library using the `search_guidelines` tool "
                "and extract the exact guideline-directed medical therapy (GDMT), diagnostic criteria, "
                "dosage recommendations, and discharge criteria relevant to the patient's conditions. "
                "Always cite which guideline file you retrieved the information from. Be precise and concise."
            ),
            tools=[search_guidelines],
            policies=[policy.allow_all()]  # Allow tool execution for search_guidelines
        )

    async def get_guidelines_for_patient(self, conditions: list[str]) -> str:
        """Retrieves and summarizes clinical guidelines relevant to a list of patient conditions."""
        prompt = (
            f"Retrieve clinical guidelines for the following patient conditions: {', '.join(conditions)}. "
            "Identify the relevant drug dosages, diagnostic thresholds, and discharge rules."
        )
        async with Agent(config=self.config) as agent:
            response = await agent.chat(prompt)
            return await response.text()
